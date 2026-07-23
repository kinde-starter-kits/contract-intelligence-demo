"""Wiring tests for the crew — no network, no real LLM.

Covers:
  - the deterministic runner drives the full endpoint flow (start → clauses →
    retrieve → flag → approve low-risk → complete), carrying the acting subject;
  - the AppClient sends the crew token + X-Acting-Subject on every call;
  - the CrewAI crew is wired with three agents each holding the four tools;
  - the risk rules are deterministic.
"""

from __future__ import annotations

import os

import pytest

from contract_crew.app_client import AppClient
from contract_crew.config import Config
from contract_crew.runner import assess_risk, run_deterministic


def _config() -> Config:
    return Config(
        convex_site_url="https://dep.convex.site",
        app_base_url="http://localhost:3000",
        kinde_domain="devrelstudio.kinde.com",
        kinde_client_id="crew-client",
        kinde_client_secret="crew-secret",
        kinde_audience="contract-intelligence-api",
        llm_model="anthropic/claude-haiku-4-5-20251001",
    )


class FakeClient:
    """Duck-typed AppClient that records calls instead of hitting the network."""

    def __init__(self, clauses):
        self._clauses = clauses
        self.calls: list[tuple] = []

    def start_review(self, contract_id, mode="intersection"):
        self.calls.append(("start_review", contract_id, mode))
        return {"reviewRunId": "run_1", "instanceId": "inst_1"}

    def get_clauses(self, contract_id):
        self.calls.append(("get_clauses", contract_id))
        return self._clauses

    def retrieve_similar(self, text, limit=3):
        self.calls.append(("retrieve_similar", text, limit))
        return []

    def flag_clause(self, review_run_id, clause_id, risk_level, rationale):
        self.calls.append(("flag_clause", review_run_id, clause_id, risk_level))
        return {"clauseId": clause_id, "riskLevel": risk_level, "status": "flagged"}

    def approve_clause(self, review_run_id, clause_id):
        self.calls.append(("approve_clause", review_run_id, clause_id))
        return {"clauseId": clause_id, "status": "approved"}

    def complete_review(self, review_run_id):
        self.calls.append(("complete_review", review_run_id))
        return {"ok": True}

    def emit_event(self, review_run_id, event_type, message="", detail=None):
        # Live run events are best-effort; record them so ordering can be checked.
        self.calls.append(("emit_event", review_run_id, event_type))
        return None


def test_deterministic_runner_drives_full_flow():
    clauses = [
        {"clauseId": "c0", "index": 0, "text": "Definitions apply as follows."},
        {"clauseId": "c1", "index": 1, "text": "Limitation of Liability is capped."},
        {"clauseId": "c2", "index": 2, "text": "Provider shall indemnify Customer."},
    ]
    client = FakeClient(clauses)
    summary = run_deterministic(
        "contract_x", "kp_user_admin", config=_config(), client=client
    )

    names = [c[0] for c in client.calls]
    assert names[0] == "start_review"
    assert "get_clauses" in names
    # Every clause gets a retrieval + a flag; only the low-risk one is approved.
    assert names.count("flag_clause") == 3
    assert names.count("retrieve_similar") == 3
    assert names.count("approve_clause") == 1  # only the low-risk "Definitions" clause
    assert names[-1] == "complete_review"

    assert summary.total_clauses == 3
    assert len(summary.flagged) == 3
    assert len(summary.approved) == 1


def test_app_client_sends_token_and_acting_subject():
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"clauses": []}

    class FakeSession:
        def post(self, url, json=None, headers=None, timeout=None):
            captured["url"] = url
            captured["headers"] = headers
            return FakeResponse()

    class FakeTokens:
        def get_token(self):
            return "crew-token-abc"

    client = AppClient(
        _config(), FakeTokens(), "kp_user_admin", session=FakeSession()
    )
    client.get_clauses("contract_x")

    assert captured["headers"]["Authorization"] == "Bearer crew-token-abc"
    assert captured["headers"]["X-Acting-Subject"] == "kp_user_admin"
    assert captured["url"].endswith("/agent/clauses")


def test_risk_rules_are_deterministic():
    assert assess_risk("Definitions apply as follows.")[0] == "low"
    assert assess_risk("The warranty is limited as stated.")[0] == "medium"
    assert assess_risk("Provider shall indemnify Customer.")[0] == "high"
    # The scariest terms escalate to critical.
    assert assess_risk("Customer liability shall be uncapped.")[0] == "critical"
    assert assess_risk("Each party waives any class action.")[0] == "critical"
    # A rule also returns its human label as the third element.
    assert assess_risk("Customer liability shall be uncapped.")[2] == (
        "uncapped liability"
    )
    # Same input twice → same output.
    assert assess_risk("Governing law is Delaware.") == assess_risk(
        "Governing law is Delaware."
    )


def test_crew_is_wired_with_three_agents_and_tools():
    # LLM construction reads a key lazily; set a dummy so nothing calls out.
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")
    from contract_crew.crew import build_crew
    from contract_crew.tools import RunContext

    ctx = RunContext(review_run_id="run_1")
    crew = build_crew(
        FakeClient([]), ctx, "contract_x", "anthropic/claude-haiku-4-5-20251001"
    )

    assert len(crew.agents) == 3
    roles = {a.role for a in crew.agents}
    assert roles == {"Clause Extractor", "Risk Flagger", "Sign-off Agent"}
    assert len(crew.tasks) == 3
    for agent in crew.agents:
        assert len(agent.tools) == 4


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
