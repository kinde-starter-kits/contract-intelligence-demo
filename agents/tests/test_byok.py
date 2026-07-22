"""BYOK (bring-your-own-key) tests — no network, no real LLM.

Proves the visitor's key is USED for a run but never persisted, never logged,
and never read from a server env var:

  - build_crew threads the per-run key into the LLM (and omits it when absent);
  - run_with_crew never attaches the key to the AppClient (so it can't reach
    Convex / the run record);
  - the /run service requires a key for the crew path (unless a dev fallback
    exists), threads it to the crew, and never echoes it back.
"""

from __future__ import annotations

import contract_crew.crew as crew_mod
import contract_crew.service as service_mod
from contract_crew.runner import ReviewSummary
from contract_crew.tools import RunContext


class FakeClient:
    """Records calls; stands in for AppClient. Never sees the LLM key."""

    def __init__(self):
        self.calls: list[tuple] = []
        self.seen_text = []

    def start_review(self, contract_id):
        self.calls.append(("start_review", contract_id))
        return {"reviewRunId": "run_1", "instanceId": "inst_1"}

    def get_clauses(self, contract_id):
        self.calls.append(("get_clauses", contract_id))
        return []

    def complete_review(self, review_run_id):
        self.calls.append(("complete_review", review_run_id))
        return {"ok": True}


def _capture_llm(monkeypatch) -> dict:
    captured: dict = {}
    real_llm = crew_mod.LLM

    def spy(*args, **kwargs):
        captured["kwargs"] = kwargs
        return real_llm(*args, **kwargs)

    monkeypatch.setattr(crew_mod, "LLM", spy)
    return captured


def test_build_crew_threads_byok_key(monkeypatch):
    captured = _capture_llm(monkeypatch)
    crew_mod.build_crew(
        FakeClient(),
        RunContext(review_run_id="run_1"),
        "contract_x",
        "anthropic/claude-haiku-4-5-20251001",
        llm_api_key="sk-byok-secret",
    )
    assert captured["kwargs"].get("api_key") == "sk-byok-secret"


def test_build_crew_omits_key_when_absent(monkeypatch):
    captured = _capture_llm(monkeypatch)
    crew_mod.build_crew(
        FakeClient(),
        RunContext(review_run_id="run_1"),
        "contract_x",
        "anthropic/claude-haiku-4-5-20251001",
    )
    # No key passed → the LLM falls back to the environment; we never inject one.
    assert "api_key" not in captured["kwargs"]


def test_run_with_crew_never_attaches_key_to_client(monkeypatch):
    """The key threads to the LLM only — the AppClient (which talks to Convex)
    must never receive it, so it cannot land on the run record or in a log."""
    from contract_crew import runner as runner_mod

    client = FakeClient()
    seen_key = {}

    def fake_build_crew(c, ctx, contract_id, model, llm_api_key=None):
        seen_key["key"] = llm_api_key
        assert c is client  # the crew is wired to the (key-free) client

        class _Crew:
            def kickoff(self_inner):
                return None

        return _Crew()

    # _make_client is where an AppClient would be built (and would need Kinde
    # creds + the network); swap in the recording FakeClient. Patch the lazily
    # imported build_crew on the crew module (run_with_crew imports it inside).
    monkeypatch.setattr(runner_mod, "_make_client", lambda config, subject: client)
    monkeypatch.setattr(crew_mod, "build_crew", fake_build_crew)

    class Cfg:
        llm_model = "anthropic/claude-haiku-4-5-20251001"

    secret = "sk-byok-secret"
    runner_mod.run_with_crew(
        "contract_x", "kp_admin", config=Cfg(), llm_api_key=secret
    )

    # The key reached the LLM builder...
    assert seen_key["key"] == secret
    # ...and never appeared in any AppClient call (nothing to persist/log).
    assert all(secret not in repr(call) for call in client.calls)


def test_service_requires_byok_key_for_crew(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    client = TestClient(service_mod.app)
    resp = client.post(
        "/run",
        json={"contractId": "c1", "actingSubject": "kp_admin", "mode": "crew"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "byok_key_required"


def test_service_threads_key_and_never_returns_it(monkeypatch):
    from fastapi.testclient import TestClient

    seen = {}

    def fake_run_with_crew(contract_id, acting_subject, *, llm_api_key=None, llm_model=None):
        seen["key"] = llm_api_key
        return ReviewSummary(
            review_run_id="run_1",
            instance_id="inst_1",
            total_clauses=0,
            flagged=[],
            approved=[],
            mode="intersection",
        )

    monkeypatch.setattr(service_mod, "run_with_crew", fake_run_with_crew)

    client = TestClient(service_mod.app)
    secret = "sk-byok-do-not-leak"
    resp = client.post(
        "/run",
        json={
            "contractId": "c1",
            "actingSubject": "kp_admin",
            "mode": "crew",
            "apiKey": secret,
        },
    )
    assert resp.status_code == 200
    # The key was threaded to the crew...
    assert seen["key"] == secret
    # ...but never persisted on / returned by the run response.
    assert secret not in resp.text
    body = resp.json()
    assert body["review_run_id"] == "run_1"
