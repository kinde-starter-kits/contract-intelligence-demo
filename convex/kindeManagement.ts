/**
 * Resolve a user's effective permissions in an org from the Kinde Management
 * API — server-side, by subject. This is how the acting human's ceiling is
 * sourced from Kinde (not a hardcoded map) when issuing their delegation at
 * review-start.
 *
 * Needs a Kinde Management-API M2M application; its credentials are read from the
 * Convex deployment env:
 *   KINDE_DOMAIN            e.g. devrelstudio.kinde.com  (already set)
 *   KINDE_MGMT_CLIENT_ID    the Management-API M2M client id
 *   KINDE_MGMT_CLIENT_SECRET its secret
 *
 * When the Management-API credentials are NOT configured, this throws
 * `kinde_management_not_configured` so the caller can decide how to fail — the
 * app never falls back to a hardcoded permission map.
 */

let cachedToken: {token: string; expiresAt: number} | null = null;

function domain(): string {
  const d = (process.env.KINDE_DOMAIN ?? '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  if (!d) throw new Error('KINDE_DOMAIN is not set.');
  return d;
}

export function isManagementConfigured(): boolean {
  return (
    !!process.env.KINDE_MGMT_CLIENT_ID && !!process.env.KINDE_MGMT_CLIENT_SECRET
  );
}

async function managementToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.token;
  }
  const clientId = process.env.KINDE_MGMT_CLIENT_ID;
  const clientSecret = process.env.KINDE_MGMT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('kinde_management_not_configured');
  }
  const d = domain();
  const resp = await fetch(`https://${d}/oauth2/token`, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: `https://${d}/api`
    })
  });
  if (!resp.ok) {
    throw new Error(
      `kinde_management_token_failed: ${resp.status} ${await resp.text()}`
    );
  }
  const json = (await resp.json()) as {
    access_token: string;
    expires_in?: number;
  };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000
  };
  return cachedToken.token;
}

/**
 * Return the permission KEYS the given user holds in the given org, from Kinde.
 * Filtered to this app's permission set by the caller.
 */
export async function resolveOrgUserPermissions(
  orgCode: string,
  userId: string
): Promise<string[]> {
  const token = await managementToken();
  const d = domain();
  const resp = await fetch(
    `https://${d}/api/v1/organizations/${orgCode}/users/${userId}/permissions`,
    {headers: {authorization: `Bearer ${token}`, accept: 'application/json'}}
  );
  if (!resp.ok) {
    throw new Error(
      `kinde_management_permissions_failed: ${resp.status} ${await resp.text()}`
    );
  }
  const json = (await resp.json()) as {
    permissions?: Array<{id?: string; key?: string}>;
  };
  const perms = (json.permissions ?? [])
    .map((p) => p.key ?? p.id)
    .filter((k): k is string => typeof k === 'string' && k.length > 0);
  // De-dupe.
  return Array.from(new Set(perms));
}
