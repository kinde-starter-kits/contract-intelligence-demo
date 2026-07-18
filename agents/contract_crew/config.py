"""Configuration for the crew, loaded from the environment.

Endpoints (two base URLs — see docs/agent-service.md for why):
  CONVEX_SITE_URL  — Convex httpActions base, e.g. https://<dep>.convex.site
  APP_BASE_URL     — Next.js app base for vector similarity, e.g. http://localhost:3000

Crew M2M identity (mints its own Kinde token, client_credentials grant):
  KINDE_DOMAIN            — tenant host, e.g. devrelstudio.kinde.com
  CREW_M2M_CLIENT_ID      — the crew M2M application's client id
  CREW_M2M_CLIENT_SECRET  — its client secret
  KINDE_AUDIENCE          — the API audience, e.g. contract-intelligence-api

LLM (configurable; the crew defaults to Claude via LiteLLM):
  CREW_LLM_MODEL   — LiteLLM model id, default anthropic/claude-haiku-4-5-20251001
  ANTHROPIC_API_KEY / OPENAI_API_KEY — provider key read by LiteLLM
"""

from __future__ import annotations

import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # dotenv is optional
    pass


DEFAULT_LLM_MODEL = "anthropic/claude-haiku-4-5-20251001"


@dataclass(frozen=True)
class Config:
    convex_site_url: str
    app_base_url: str
    kinde_domain: str
    kinde_client_id: str
    kinde_client_secret: str
    kinde_audience: str
    llm_model: str


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _kinde_domain() -> str:
    # Accept either KINDE_DOMAIN (host only) or KINDE_ISSUER_URL (with scheme).
    domain = os.environ.get("KINDE_DOMAIN", "").strip()
    if domain:
        return domain.replace("https://", "").replace("http://", "").rstrip("/")
    issuer = os.environ.get("KINDE_ISSUER_URL", "").strip()
    if issuer:
        return issuer.replace("https://", "").replace("http://", "").rstrip("/")
    raise RuntimeError("Set KINDE_DOMAIN (or KINDE_ISSUER_URL).")


def load_config() -> Config:
    return Config(
        convex_site_url=_require("CONVEX_SITE_URL").rstrip("/"),
        app_base_url=os.environ.get(
            "APP_BASE_URL", "http://localhost:3000"
        ).rstrip("/"),
        kinde_domain=_kinde_domain(),
        kinde_client_id=_require("CREW_M2M_CLIENT_ID"),
        kinde_client_secret=_require("CREW_M2M_CLIENT_SECRET"),
        kinde_audience=os.environ.get(
            "KINDE_AUDIENCE", "contract-intelligence-api"
        ).strip(),
        llm_model=os.environ.get("CREW_LLM_MODEL", DEFAULT_LLM_MODEL).strip(),
    )
