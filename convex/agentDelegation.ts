import {internalMutation, internalQuery} from './_generated/server';
import {components} from './_generated/api';
import {v, GenericId} from 'convex/values';

/**
 * Issue a delegation from a human to the crew agent — the human's PERMISSION
 * CEILING for a run. In intersection mode the component's `authorize()` finds
 * this delegation (by the instance's `actingForSubject`) and intersects its
 * scopes with the agent's, so the agent can never exceed what the human could do.
 *
 * WHERE THE PERMISSIONS COME FROM: in the app, a signed-in human authorizes the
 * crew and the server reads their granted permissions from their verified Kinde
 * session (`lib/kinde.ts` `resolveSessionPermissions`) — that is the
 * "resolve the acting human's permissions from Kinde" step. This internal
 * mutation persists them as a signed delegation. (The headless repro calls it
 * directly with the acting user's permission set.)
 *
 * Internal + admin-only: never a public client surface.
 */
export const issueHumanDelegation = internalMutation({
  args: {
    agentId: v.string(),
    actingSubject: v.string(),
    permissions: v.array(v.string()),
    ttlMs: v.optional(v.number())
  },
  returns: v.object({
    delegationId: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.number()
  }),
  handler: async (ctx, args) => {
    const expiresAt = Date.now() + (args.ttlMs ?? 60 * 60 * 1000);
    const delegationId = await ctx.runMutation(
      components.agentAuth.delegations.issue,
      {
        agentId: args.agentId as GenericId<'agents'>,
        scopes: args.permissions,
        expiresAt,
        issuerKind: 'user',
        issuerSubject: args.actingSubject
      }
    );
    return {delegationId, scopes: args.permissions, expiresAt};
  }
});

/**
 * Read the component's recent audit rows for an org — each decision tied to the
 * acting identity (`actingFor`), the permission/scopes checked (`scopesUsed`),
 * the outcome (`decision`), and a `correlationId`. Used to show the audit trail
 * for the intersection demo.
 */
export const recentAudit = internalQuery({
  args: {
    orgCode: v.string(),
    limit: v.optional(v.number())
  },
  returns: v.array(
    v.object({
      eventType: v.string(),
      decision: v.union(v.literal('allow'), v.literal('deny'), v.null()),
      // `actingFor` is not set on authz.decision rows; the acting human's
      // ceiling is captured by `scopesUsed`, and `detail.callerSubject` records
      // the calling agent. Both surfaced here.
      actingFor: v.union(v.string(), v.null()),
      action: v.union(v.string(), v.null()),
      reason: v.union(v.string(), v.null()),
      callerSubject: v.union(v.string(), v.null()),
      scopesUsed: v.union(v.array(v.string()), v.null()),
      correlationId: v.union(v.string(), v.null()),
      instanceId: v.union(v.string(), v.null()),
      at: v.number()
    })
  ),
  handler: async (ctx, args) => {
    const res = await ctx.runQuery(components.agentAuth.audit.query, {
      orgCode: args.orgCode,
      paginationOpts: {numItems: args.limit ?? 20, cursor: null}
    });
    const asStr = (x: unknown): string | null =>
      typeof x === 'string' ? x : null;
    return res.page.map((r) => ({
      eventType: r.eventType,
      decision: r.decision,
      actingFor: r.actingFor,
      action: asStr(r.detail?.action),
      reason: asStr(r.detail?.reason),
      callerSubject: asStr(r.detail?.callerSubject),
      scopesUsed: r.scopesUsed,
      correlationId: r.correlationId,
      instanceId: r.instanceId,
      at: r.at
    }));
  }
});
