"""CrewAI tools that wrap the AppClient. Every tool call the crew makes goes
through these, and therefore carries the crew M2M token + acting subject. The
crew has no other way to touch data."""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from crewai.tools import tool

from .app_client import AppClient


@dataclass
class RunContext:
    """Shared state for one review run: the run id and what the crew decided."""

    review_run_id: str
    flagged: list[dict] = field(default_factory=list)
    approved: list[dict] = field(default_factory=list)


def make_tools(client: AppClient, ctx: RunContext) -> list:
    """Build the crew's tools, bound to one AppClient + review run."""

    @tool("get_contract_clauses")
    def get_contract_clauses(contract_id: str) -> str:
        """Fetch all clauses of a contract (id, index, text, riskLevel, status).
        Returns a JSON array."""
        return json.dumps(client.get_clauses(contract_id))

    @tool("retrieve_similar_clauses")
    def retrieve_similar_clauses(clause_text: str) -> str:
        """Retrieve clauses similar to the given text from the org's clause
        library, for risk context. Returns a JSON array of matches."""
        return json.dumps(client.retrieve_similar(clause_text, limit=3))

    @tool("flag_clause")
    def flag_clause(clause_id: str, risk_level: str, rationale: str) -> str:
        """Flag a clause with a risk level (one of: low, medium, high) and a
        short rationale. Returns the updated clause as JSON."""
        result = client.flag_clause(
            ctx.review_run_id, clause_id, risk_level, rationale
        )
        ctx.flagged.append(result)
        return json.dumps(result)

    @tool("approve_clause")
    def approve_clause(clause_id: str) -> str:
        """Approve a clause that passes review (typically low risk). Returns the
        updated clause as JSON."""
        result = client.approve_clause(ctx.review_run_id, clause_id)
        ctx.approved.append(result)
        return json.dumps(result)

    return [
        get_contract_clauses,
        retrieve_similar_clauses,
        flag_clause,
        approve_clause,
    ]
