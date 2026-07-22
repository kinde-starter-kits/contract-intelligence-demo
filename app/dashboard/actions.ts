'use server';

import {getActingIdentity} from '@/lib/acting-identity';
import {errorText} from '@/lib/error-text';
import {mintCrewToken} from '@/lib/agent-run';

/**
 * The dashboard's approve action, wired through the REAL crew endpoint. The
 * acting human (a guest test user OR a signed-in human) clicks "approve"; the
 * server (holding the crew M2M secret) directs the crew to approve the clause ON
 * BEHALF OF that human (X-Acting-Subject = their real Kinde id). In intersection
 * mode review-start resolves the human's ceiling from Kinde and issues their
 * delegation, so the component's authorize() decides human ∩ agent — a read-only
 * Intern who forces the button still gets the backend 403 surfaced here.
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

export async function approveClauseAsHuman(
  contractId: string,
  clauseId: string
): Promise<ApproveResult> {
  const identity = await getActingIdentity();
  if (!identity.subject) {
    return {ok: false, status: 401, error: 'no_acting_identity'};
  }

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
    'x-acting-subject': identity.subject,
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
      error: errorText(start.error, 'review_start_failed'),
      reason: errorText(start.detail ?? start.error, '') || null
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
    reason: approve.reason == null ? null : errorText(approve.reason, ''),
    correlationId: approve.correlationId,
    requiredScopes: approve.requiredScopes,
    error: approve.error == null ? undefined : errorText(approve.error, 'error')
  };
}
