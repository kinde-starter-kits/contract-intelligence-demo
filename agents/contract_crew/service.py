"""HTTP service that runs a review on demand — the BYOK (bring-your-own-key) path.

  POST /run  { contractId, actingSubject, apiKey?, model?, mode? }

The visitor's LLM key arrives on the request, is threaded straight to the crew's
LLM for THIS run only, and is then discarded. It is NEVER persisted (not in
Convex, not on the run record — the run only ever stores flags/approvals via the
crew M2M endpoints), NEVER logged, and is NOT read from or written to a server
env var. The Next.js `/api/run` route is the only intended caller; it derives
`actingSubject` from the server-side acting identity (guest or Kinde), so the
client cannot spoof who the crew acts for.

Run it (product path):
  uvicorn contract_crew.service:app --port 8790
"""

from __future__ import annotations

import os
from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .runner import run_deterministic, run_with_crew

app = FastAPI(title="Contract review crew")


class RunRequest(BaseModel):
    contractId: str
    actingSubject: str
    # BYOK — the visitor's provider key, used only for this run. Optional so that
    # a local-dev server key (env) can back the crew instead; the product path is
    # for the caller to supply this.
    apiKey: str | None = None
    model: str | None = None
    mode: str = "crew"
    # Demo operator's requested authorization mode (broken|intersection); the
    # Convex server honors it only when DEMO_MODE_SELECTABLE is on.
    authzMode: str | None = None


def _has_server_fallback_key() -> bool:
    return bool(
        os.environ.get("ANTHROPIC_API_KEY", "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
    )


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/run")
def run(req: RunRequest) -> dict:
    key = (req.apiKey or "").strip() or None

    if req.mode not in ("crew", "deterministic"):
        raise HTTPException(status_code=400, detail="invalid_mode")

    # Guardrail: the crew (LLM) path needs a key. Require BYOK unless a server
    # fallback key exists (local dev). We check presence only — never echo it.
    if req.mode == "crew" and key is None and not _has_server_fallback_key():
        raise HTTPException(status_code=400, detail="byok_key_required")

    try:
        if req.mode == "deterministic":
            summary = run_deterministic(req.contractId, req.actingSubject)
        else:
            summary = run_with_crew(
                req.contractId,
                req.actingSubject,
                llm_api_key=key,
                llm_model=req.model,
                authz_mode=req.authzMode,
            )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - surface a friendly, key-free error
        # Map an upstream provider auth rejection to a clear message. We inspect
        # only the exception TYPE/status, never re-emit the key or the request.
        message = str(exc).lower()
        if "authentication" in message or "invalid api key" in message or "401" in message:
            raise HTTPException(status_code=400, detail="llm_key_rejected") from None
        raise HTTPException(status_code=502, detail="crew_run_failed") from None

    return asdict(summary)
