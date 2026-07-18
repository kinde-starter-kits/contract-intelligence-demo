"""Mint (and cache) the crew's own Kinde M2M access token via the
client_credentials grant, for the API audience. This token is what proves the
crew's machine identity to the app on every request."""

from __future__ import annotations

import time

import requests


class TokenProvider:
    """Mints and caches a crew M2M access token, refreshing before expiry."""

    def __init__(
        self,
        domain: str,
        client_id: str,
        client_secret: str,
        audience: str,
        *,
        session: requests.Session | None = None,
    ) -> None:
        self._domain = domain
        self._client_id = client_id
        self._client_secret = client_secret
        self._audience = audience
        self._session = session or requests.Session()
        self._token: str | None = None
        self._expires_at: float = 0.0

    def get_token(self) -> str:
        # Refresh 30s before actual expiry.
        if self._token and time.time() < self._expires_at - 30:
            return self._token

        resp = self._session.post(
            f"https://{self._domain}/oauth2/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "audience": self._audience,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=20,
        )
        resp.raise_for_status()
        payload = resp.json()
        self._token = payload["access_token"]
        self._expires_at = time.time() + float(payload.get("expires_in", 3600))
        return self._token
