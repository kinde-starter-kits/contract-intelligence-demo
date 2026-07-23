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

# Ordered rules, scariest tier first; first keyword hit wins. Each rule carries a
# short human label so the timeline can say WHAT is dangerous, not just a level.
# Mirrors lib/agent-run.ts::RULES so the TS driver and this crew agree on risk.
_RULES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("critical", "uncapped liability", ("uncapped", "unlimited liability")),
    ("critical", "class-action waiver", ("class action", "class-action")),
    ("high", "auto-renewal (evergreen)", ("automatically renew", "auto-renew", "evergreen")),
    ("high", "broad indemnification", ("indemnif",)),
    ("high", "GDPR / data-processing obligations", ("personal data", "gdpr", "data protection")),
    ("high", "HIPAA / PHI handling", ("protected health information", "hipaa")),
    ("high", "IP assignment / work-for-hire", ("work made for hire", "irrevocably assign")),
    ("high", "non-compete / non-solicit", ("non-compete", "non-competition", "non-solicit")),
    ("high", "mandatory arbitration", ("arbitration",)),
    ("medium", "late-payment penalties", ("late payment", "past due")),
    ("medium", "warranty disclaimer", ("warrant",)),
    ("medium", "termination terms", ("terminat",)),
    ("medium", "confidentiality terms", ("confidential",)),
)


def assess_risk(text: str) -> tuple[str, str, str]:
    """Return (level, rationale, label). Risk scoring only — never affects authz."""
    lowered = text.lower()
    for level, label, keywords in _RULES:
        if any(kw in lowered for kw in keywords):
            word = {"critical": "Critical", "high": "High"}.get(level, "Medium")
            return level, f"{word} risk: {label}.", label
    return "low", "Standard, low-risk boilerplate.", "standard terms"


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
    config: Config | None = None,
    client: AppClient | None = None,
) -> ReviewSummary:
    config = config or load_config()
    client = client or _make_client(config, acting_subject)

    started = client.start_review(contract_id)
    review_run_id = started["reviewRunId"]
    ctx = RunContext(review_run_id=review_run_id)

    client.emit_event(review_run_id, "extractor_started", "Clause Extractor started.")
    clauses = client.get_clauses(contract_id)
    for clause in clauses:
        idx = clause.get("index")
        client.emit_event(
            review_run_id,
            "clause_extracted",
            f"Clause {idx} extracted.",
            {"clauseId": clause["clauseId"], "clauseIndex": idx},
        )
        # Use the retrieval seam for risk context (best-effort; the decision is
        # rule-based here so a retrieval hiccup doesn't abort the review).
        try:
            client.retrieve_similar(clause["text"], limit=3)
        except Exception as exc:  # pragma: no cover - network best-effort
            print(f"  (similar retrieval skipped for {clause['clauseId']}: {exc})")

        risk, rationale, label = assess_risk(clause["text"])
        assessed_msg = (
            f"Clause {idx} assessed: {risk.upper()} — {label}."
            if risk in ("critical", "high")
            else f"Clause {idx} assessed: medium risk — {label}."
            if risk == "medium"
            else f"Clause {idx} assessed: low risk."
        )
        client.emit_event(
            review_run_id,
            "clause_assessed",
            assessed_msg,
            {
                "clauseId": clause["clauseId"],
                "clauseIndex": idx,
                "riskLevel": risk,
                "label": label,
            },
        )
        ctx.flagged.append(
            client.flag_clause(review_run_id, clause["clauseId"], risk, rationale)
        )
        if risk == "low":
            client.emit_event(
                review_run_id,
                "signoff_attempted",
                f"Sign-off attempted for clause {idx}.",
                {"clauseId": clause["clauseId"], "clauseIndex": idx},
            )
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
        mode=started.get("mode", "broken"),
    )


def run_with_crew(
    contract_id: str,
    acting_subject: str,
    *,
    config: Config | None = None,
    llm_api_key: str | None = None,
    llm_model: str | None = None,
    authz_mode: str | None = None,
) -> ReviewSummary:
    from .crew import build_crew  # imported lazily so no-LLM runs don't need it

    config = config or load_config()
    client = _make_client(config, acting_subject)

    started = client.start_review(contract_id, authz_mode)
    ctx = RunContext(review_run_id=started["reviewRunId"])

    # BYOK: the per-run key threads to the LLM only; it is never attached to the
    # AppClient, never sent to Convex, and never recorded on the run.
    crew = build_crew(
        client, ctx, contract_id, llm_model or config.llm_model, llm_api_key
    )
    crew.kickoff()

    client.complete_review(ctx.review_run_id)
    clauses = client.get_clauses(contract_id)
    return ReviewSummary(
        review_run_id=ctx.review_run_id,
        instance_id=started["instanceId"],
        total_clauses=len(clauses),
        flagged=ctx.flagged,
        approved=ctx.approved,
        mode=started.get("mode", "broken"),
    )
