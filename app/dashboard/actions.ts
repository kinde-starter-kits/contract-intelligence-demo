'use server';

import {getKindeServerSession} from '@kinde-oss/kinde-auth-nextjs/server';

/**
 * The dashboard's approve action, wired through the REAL crew endpoint. The
 * signed-in human clicks "approve"; the server (holding the crew M2M secret)
 * directs the crew to approve the clause ON BEHALF OF that human
 * (X-Acting-Subject = the human's Kinde id). In intersection mode review-start
 * resolves the human's ceiling from Kinde and issues their delegation, so the
 * component's authorize() decides human ∩ agent — a read-only Intern who forces
 * the button still gets the backend 403 with its reason surfaced here.
 */

export interface ApproveResult {
  ok: boolean;
  status: number;
  mode?: string;
  clauseStatus?: string;
  reason?: string | null;
  correlationId?: string | null;
  requiredScopes?: string[];
  error?: string;
}

async function mintCrewToken(): Promise<string> {
  const issuer = process.env.KINDE_ISSUER_URL;
  const resp = await fetch(`${issuer}/oauth2/token`, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.CREW_M2M_CLIENT_ID ?? '',
      client_secret: process.env.CREW_M2M_CLIENT_SECRET ?? '',
      audience: process.env.KINDE_AUDIENCE ?? ''
    })
  });
  if (!resp.ok) throw new Error(`crew token mint failed: ${resp.status}`);
  return (await resp.json()).access_token as string;
}

export async function approveClauseAsHuman(
  contractId: string,
  clauseId: string
): Promise<ApproveResult> {
  const {getUser} = getKindeServerSession();
  const user = await getUser();
  if (!user?.id) return {ok: false, status: 401, error: 'not_authenticated'};

  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!site) return {ok: false, status: 500, error: 'convex_site_unconfigured'};

  let token: string;
  try {
    token = await mintCrewToken();
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: e instanceof Error ? e.message : 'mint_failed'
    };
  }

  const headers = {
    authorization: `Bearer ${token}`,
    'x-acting-subject': user.id,
    'content-type': 'application/json'
  };

  const startResp = await fetch(`${site}/agent/review/start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({contractId})
  });
  const start = await startResp.json();
  if (!startResp.ok) {
    return {
      ok: false,
      status: startResp.status,
      error: start.error ?? 'review_start_failed',
      reason: start.detail ?? start.error
    };
  }

  const approveResp = await fetch(`${site}/agent/approve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({reviewRunId: start.reviewRunId, clauseId})
  });
  const approve = await approveResp.json();
  if (approveResp.ok) {
    return {
      ok: true,
      status: 200,
      mode: approve.authz?.mode,
      clauseStatus: approve.status
    };
  }
  return {
    ok: false,
    status: approveResp.status,
    mode: approve.mode,
    reason: approve.reason,
    correlationId: approve.correlationId,
    requiredScopes: approve.requiredScopes,
    error: approve.error
  };
}
