import {httpRouter} from 'convex/server';
import {httpAction, ActionCtx} from './_generated/server';
import {internal} from './_generated/api';
import {resolveAuthzMode, authorizeAgentAction} from './authz';
import {resolveOrgUserPermissions} from './kindeManagement';

// This app's permission set — the ceiling passed into the delegation is filtered
// to these (the intersection with agent.scopes limits it anyway).
const APP_PERMISSIONS = new Set([
  'contracts:read',
  'clauses:flag',
  'clauses:approve'
]);

/**
 * The crew's HTTP surface (base: `<deployment>.convex.site`).
 *
 * WHY Convex httpActions (and not Next.js routes) for these: token verification
 * and every data write happen entirely inside Convex — the endpoint verifies the
 * crew's Kinde M2M token through the component's `verifyCaller` and writes via
 * `internal.*` mutations. No admin key, no trust-boundary hop. (The one endpoint
 * that CAN'T live here is vector similarity — it embeds the query with the ONNX
 * runtime, which Convex can't host — so it's a Next.js route: app/api/agent/similar.)
 *
 * AUTH ON EVERY CALL:
 *   - `Authorization: Bearer <crew M2M access token>` — verified via the
 *     component (rejected with 401 when missing/invalid).
 *   - `X-Acting-Subject: <kinde user id>` — the human on whose behalf the crew
 *     acts. Recorded on the review run and credited on each decision. This is
 *     the value the authz phases will intersect against the human's delegated
 *     permissions.
 */

const http = httpRouter();

function bearer(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'}
  });
}

/**
 * Verify the crew token and pull the acting subject. Returns the verified
 * identity, or a Response to short-circuit with (401/400).
 */
async function authenticate(
  ctx: ActionCtx,
  request: Request
): Promise<
  | {
      ok: true;
      token: string;
      agentId: string;
      orgCode: string;
      subject: string;
      actingSubject: string;
    }
  | {ok: false; response: Response}
> {
  const token = bearer(request);
  if (!token) {
    return {ok: false, response: json({error: 'missing_bearer_token'}, 401)};
  }
  let verified;
  try {
    verified = await ctx.runAction(internal.agentIdentity.verifyCrewToken, {
      token
    });
  } catch (e) {
    return {
      ok: false,
      response: json(
        {
          error: 'invalid_token',
          detail: e instanceof Error ? e.message : String(e)
        },
        401
      )
    };
  }
  if (!verified.agentId || !verified.orgCode) {
    return {
      ok: false,
      response: json({error: 'token_not_bound_to_registered_org_agent'}, 403)
    };
  }
  const actingSubject = request.headers.get('X-Acting-Subject');
  if (!actingSubject) {
    return {ok: false, response: json({error: 'missing_acting_subject'}, 400)};
  }
  return {
    ok: true,
    token,
    agentId: verified.agentId,
    orgCode: verified.orgCode,
    subject: verified.subject,
    actingSubject
  };
}

// POST /agent/review/start  { contractId } -> { reviewRunId, instanceId, mode }
//   `mode` is decided server-side by AUTHZ_MODE, not by the request.
http.route({
  path: '/agent/review/start',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    if (!body?.contractId) return json({error: 'missing_contractId'}, 400);
    // The SERVER decides the authorization mode (deployment env AUTHZ_MODE),
    // never the calling agent. Any `mode` in the request body is ignored.
    const mode = resolveAuthzMode();

    // Intersection: resolve the acting human's permissions FROM KINDE (their
    // ceiling) and issue their delegation for this run — sourced from Kinde, not
    // a hardcoded map. broken mode never consults the human, so it skips this.
    if (mode === 'intersection') {
      try {
        const perms = await resolveOrgUserPermissions(
          auth.orgCode,
          auth.actingSubject
        );
        const ceiling = perms.filter((p) => APP_PERMISSIONS.has(p));
        await ctx.runMutation(internal.agentDelegation.issueHumanDelegation, {
          agentId: auth.agentId,
          actingSubject: auth.actingSubject,
          permissions: ceiling
        });
      } catch (e) {
        return json(
          {
            error: 'permission_resolution_failed',
            detail: e instanceof Error ? e.message : String(e)
          },
          502
        );
      }
    }

    try {
      const result = await ctx.runMutation(internal.agentReview.startReview, {
        agentId: auth.agentId,
        orgCode: auth.orgCode,
        actingSubject: auth.actingSubject,
        contractId: body.contractId,
        mode
      });
      return json(result, 200);
    } catch (e) {
      return json({error: e instanceof Error ? e.message : String(e)}, 400);
    }
  })
});

// POST /agent/clauses  { contractId } -> { clauses: [...] }
http.route({
  path: '/agent/clauses',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    if (!body?.contractId) return json({error: 'missing_contractId'}, 400);
    try {
      const clauses = await ctx.runQuery(
        internal.agentReview.listClausesForAgent,
        {orgCode: auth.orgCode, contractId: body.contractId}
      );
      return json({clauses}, 200);
    } catch (e) {
      return json({error: e instanceof Error ? e.message : String(e)}, 400);
    }
  })
});

// POST /agent/flag  { reviewRunId, clauseId, riskLevel, rationale } -> { ... }
http.route({
  path: '/agent/flag',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    if (!body?.reviewRunId || !body?.clauseId || !body?.riskLevel) {
      return json({error: 'missing_flag_fields'}, 400);
    }
    try {
      const run = await ctx.runQuery(internal.agentReview.getReviewRun, {
        reviewRunId: body.reviewRunId,
        orgCode: auth.orgCode
      });
      if (!run) return json({error: 'review_run_not_found'}, 404);

      const decision = await authorizeAgentAction(ctx, auth.token, {
        mode: run.mode,
        instanceId: run.instanceId,
        action: 'clauses:flag'
      });
      if (!decision.allowed) {
        return json({error: 'authorization_denied', ...decision}, 403);
      }

      const result = await ctx.runMutation(internal.agentReview.flagClause, {
        orgCode: auth.orgCode,
        actingSubject: auth.actingSubject,
        reviewRunId: body.reviewRunId,
        clauseId: body.clauseId,
        riskLevel: body.riskLevel,
        rationale: body.rationale ?? '',
        authz: decision
      });
      return json(result, 200);
    } catch (e) {
      return json({error: e instanceof Error ? e.message : String(e)}, 400);
    }
  })
});

// POST /agent/approve  { reviewRunId, clauseId } -> { ... }
http.route({
  path: '/agent/approve',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    if (!body?.reviewRunId || !body?.clauseId) {
      return json({error: 'missing_approve_fields'}, 400);
    }
    try {
      const run = await ctx.runQuery(internal.agentReview.getReviewRun, {
        reviewRunId: body.reviewRunId,
        orgCode: auth.orgCode
      });
      if (!run) return json({error: 'review_run_not_found'}, 404);

      const decision = await authorizeAgentAction(ctx, auth.token, {
        mode: run.mode,
        instanceId: run.instanceId,
        action: 'clauses:approve'
      });
      if (!decision.allowed) {
        // Human ∩ agent denied it (e.g. a read-only Intern). Machine-readable
        // reason + correlationId; the clause is NOT flipped.
        return json({error: 'authorization_denied', ...decision}, 403);
      }

      const result = await ctx.runMutation(internal.agentReview.approveClause, {
        orgCode: auth.orgCode,
        actingSubject: auth.actingSubject,
        reviewRunId: body.reviewRunId,
        clauseId: body.clauseId,
        authz: decision
      });
      return json(result, 200);
    } catch (e) {
      return json({error: e instanceof Error ? e.message : String(e)}, 400);
    }
  })
});

// POST /agent/review/complete  { reviewRunId } -> {}
http.route({
  path: '/agent/review/complete',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    if (!body?.reviewRunId) return json({error: 'missing_reviewRunId'}, 400);
    try {
      await ctx.runMutation(internal.agentReview.completeReview, {
        orgCode: auth.orgCode,
        reviewRunId: body.reviewRunId
      });
      return json({ok: true}, 200);
    } catch (e) {
      return json({error: e instanceof Error ? e.message : String(e)}, 400);
    }
  })
});

export default http;
