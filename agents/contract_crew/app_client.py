"""HTTP client for the app's crew endpoints.

Every request carries:
  - Authorization: Bearer <crew M2M token>   (machine identity)
  - X-Acting-Subject: <kinde user id>         (the human the crew acts for)

The Convex httpActions (review/clauses/flag/approve) live at CONVEX_SITE_URL;
vector similarity lives at APP_BASE_URL (Next.js). The crew NEVER talks to
Convex or Weaviate directly — only these endpoints.
"""

from __future__ import annotations

from typing import Any

import requests

from .config import Config
from .kinde_auth import TokenProvider


class AppClient:
    def __init__(
        self,
        config: Config,
        token_provider: TokenProvider,
        acting_subject: str,
        *,
        session: requests.Session | None = None,
    ) -> None:
        self._config = config
        self._tokens = token_provider
        self._acting_subject = acting_subject
        self._session = session or requests.Session()

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._tokens.get_token()}",
            "X-Acting-Subject": self._acting_subject,
            "Content-Type": "application/json",
        }

    def _post_convex(self, path: str, payload: dict[str, Any]) -> Any:
        resp = self._session.post(
            f"{self._config.convex_site_url}{path}",
            json=payload,
            headers=self._headers(),
            timeout=45,
        )
        resp.raise_for_status()
        return resp.json()

    def emit_event(
        self,
        review_run_id: str,
        event_type: str,
        message: str = "",
        detail: dict | None = None,
    ) -> None:
        """Emit a live run event (best-effort; a missed event never fails a run)."""
        try:
            self._post_convex(
                "/agent/event",
                {
                    "reviewRunId": review_run_id,
                    "type": event_type,
                    "message": message,
                    "detail": detail or {},
                },
            )
        except Exception:  # pragma: no cover - events are best-effort
            pass

    # --- Review lifecycle ---

    def start_review(self, contract_id: str) -> dict:
        # The SERVER decides the authorization mode (AUTHZ_MODE); the crew does
        # not send one. The response reports the effective mode.
        return self._post_convex("/agent/review/start", {"contractId": contract_id})

    def complete_review(self, review_run_id: str) -> dict:
        return self._post_convex(
            "/agent/review/complete", {"reviewRunId": review_run_id}
        )

    # --- Reads ---

    def get_clauses(self, contract_id: str) -> list[dict]:
        return self._post_convex("/agent/clauses", {"contractId": contract_id})[
            "clauses"
        ]

    def retrieve_similar(self, text: str, limit: int = 3) -> list[dict]:
        # Vector similarity is the Next.js route (embedding runs there).
        resp = self._session.post(
            f"{self._config.app_base_url}/api/agent/similar",
            json={"text": text, "limit": limit},
            headers=self._headers(),
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["matches"]

    # --- Writes ---

    def flag_clause(
        self, review_run_id: str, clause_id: str, risk_level: str, rationale: str
    ) -> dict:
        return self._post_convex(
            "/agent/flag",
            {
                "reviewRunId": review_run_id,
                "clauseId": clause_id,
                "riskLevel": risk_level,
                "rationale": rationale,
            },
        )

    def approve_clause(self, review_run_id: str, clause_id: str) -> dict:
        return self._post_convex(
            "/agent/approve",
            {"reviewRunId": review_run_id, "clauseId": clause_id},
        )
