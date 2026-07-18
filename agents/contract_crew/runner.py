"""Run a contract review.

Two ways to drive the same tools + endpoints:

  - run_with_crew(): the real CrewAI crew (three LLM agents). Needs an LLM key.
  - run_deterministic(): a rule-based orchestration that calls the identical
    AppClient tools (start review → get clauses → retrieve similar → flag →
    approve low-risk → complete). No LLM key required — used for CI and for
    demonstrating the endpoint/token flow (the authz-relevant part) end to end.

Both authenticate as the crew M2M and carry the acting human's subject on every
request; both record everything on a review run.
"""

from __future__ import annotations

from dataclasses import dataclass

from .app_client import AppClient
from .config import Config, load_config
from .kinde_auth import TokenProvider
from .tools import RunContext


@dataclass
class ReviewSummary:
    review_run_id: str
    instance_id: str
    total_clauses: int
    flagged: list[dict]
    approved: list[dict]
    mode: str

    def describe(self) -> str:
        lines = [
            f"Review run: {self.review_run_id}",
            f"Agent-auth instance: {self.instance_id}",
            f"Mode (recorded): {self.mode}",
            f"Clauses: {self.total_clauses}  flagged: {len(self.flagged)}  approved: {len(self.approved)}",
        ]
        for f in self.flagged:
            lines.append(
                f"  flag  {f.get('clauseId')}  risk={f.get('riskLevel')}"
            )
        for a in self.approved:
            lines.append(f"  approve {a.get('clauseId')}")
        return "\n".join(lines)


# --- Deterministic (no-LLM) risk assessment -------------------------------

_HIGH = ("indemnif", "unlimited liability", "penalty", "liquidated damages")
_MEDIUM = (
    "limitation of liability",
    "liability",
    "terminat",
    "governing law",
    "confidential",
    "warrant",
    "indemn",
)


def assess_risk(text: str) -> tuple[str, str]:
    lowered = text.lower()
    for kw in _HIGH:
        if kw in lowered:
            return "high", f"Contains high-risk language ('{kw}')."
    for kw in _MEDIUM:
        if kw in lowered:
            return "medium", f"Contains risk-relevant language ('{kw}'); review advised."
    return "low", "Boilerplate / low-risk clause."


def _make_client(config: Config, acting_subject: str) -> AppClient:
    tokens = TokenProvider(
        config.kinde_domain,
        config.kinde_client_id,
        config.kinde_client_secret,
        config.kinde_audience,
    )
    return AppClient(config, tokens, acting_subject)


def run_deterministic(
    contract_id: str,
    acting_subject: str,
    *,
    review_mode: str = "intersection",
    config: Config | None = None,
    client: AppClient | None = None,
) -> ReviewSummary:
    config = config or load_config()
    client = client or _make_client(config, acting_subject)

    started = client.start_review(contract_id, mode=review_mode)
    review_run_id = started["reviewRunId"]
    ctx = RunContext(review_run_id=review_run_id)

    clauses = client.get_clauses(contract_id)
    for clause in clauses:
        # Use the retrieval seam for risk context (best-effort; the decision is
        # rule-based here so a retrieval hiccup doesn't abort the review).
        try:
            client.retrieve_similar(clause["text"], limit=3)
        except Exception as exc:  # pragma: no cover - network best-effort
            print(f"  (similar retrieval skipped for {clause['clauseId']}: {exc})")

        risk, rationale = assess_risk(clause["text"])
        ctx.flagged.append(
            client.flag_clause(review_run_id, clause["clauseId"], risk, rationale)
        )
        if risk == "low":
            ctx.approved.append(
                client.approve_clause(review_run_id, clause["clauseId"])
            )

    client.complete_review(review_run_id)
    return ReviewSummary(
        review_run_id=review_run_id,
        instance_id=started["instanceId"],
        total_clauses=len(clauses),
        flagged=ctx.flagged,
        approved=ctx.approved,
        mode=review_mode,
    )


def run_with_crew(
    contract_id: str,
    acting_subject: str,
    *,
    review_mode: str = "intersection",
    config: Config | None = None,
) -> ReviewSummary:
    from .crew import build_crew  # imported lazily so no-LLM runs don't need it

    config = config or load_config()
    client = _make_client(config, acting_subject)

    started = client.start_review(contract_id, mode=review_mode)
    ctx = RunContext(review_run_id=started["reviewRunId"])

    crew = build_crew(client, ctx, contract_id, config.llm_model)
    crew.kickoff()

    client.complete_review(ctx.review_run_id)
    clauses = client.get_clauses(contract_id)
    return ReviewSummary(
        review_run_id=ctx.review_run_id,
        instance_id=started["instanceId"],
        total_clauses=len(clauses),
        flagged=ctx.flagged,
        approved=ctx.approved,
        mode=review_mode,
    )
