import {internalMutation, internalQuery} from './_generated/server';
import {v, GenericId} from 'convex/values';
import {agentAuth} from './agentAuth';

/**
 * Admin-only host wrappers around the component's agent registry.
 *
 * Per the component's security model, `agents.register` is an admin/provisioning
 * function that must NEVER be exposed publicly — a component mutation has no auth
 * of its own, so the host app is the boundary. These are `internal*` functions:
 * unreachable from any client, callable only from other Convex functions or the
 * admin CLI (`npx convex run`).
 */

/** Look up an already-registered agent by its Kinde M2M client id (idempotency). */
export const getAgentByClientId = internalQuery({
  args: {
    kindeClientId: v.string(),
    orgCode: v.optional(v.union(v.string(), v.null()))
  },
  returns: v.union(
    v.object({
      agentId: v.string(),
      name: v.string(),
      slug: v.string(),
      scopes: v.array(v.string()),
      allowedTools: v.array(v.string()),
      orgCode: v.union(v.string(), v.null())
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const agents = await agentAuth.listAgents(ctx, {});
    const match = agents.find(
      (a) =>
        a.kindeClientId === args.kindeClientId &&
        // Treat undefined orgCode arg as "any org".
        (args.orgCode === undefined || a.orgCode === args.orgCode)
    );
    if (!match) return null;
    return {
      agentId: match._id,
      name: match.name,
      slug: match.slug,
      scopes: match.scopes,
      allowedTools: match.allowedTools,
      orgCode: match.orgCode
    };
  }
});

/**
 * Register the crew's M2M application as an agent in the component's registry,
 * so that a token minted by that M2M app (its `azp` = this `kindeClientId`)
 * resolves to a known agent during `verifyCaller`.
 *
 * Idempotent: if an agent for this `kindeClientId` (+ `orgCode`) already exists,
 * it returns that agent's id and does not create a duplicate.
 *
 * `scopes` are the crew's coarse M2M scopes — deliberately broad here, because
 * the confused-deputy demo turns on the gap between what the crew *could* do
 * (these scopes) and what a specific human actually delegated. The fix in a
 * later phase intersects these with the human's permissions.
 */
export const provisionAgent = internalMutation({
  args: {
    kindeClientId: v.string(),
    name: v.string(),
    slug: v.string(),
    scopes: v.array(v.string()),
    allowedTools: v.array(v.string()),
    // Org-scoped M2M app → bind the agent to that Kinde org. Omit/null for a
    // tenant-less agent.
    orgCode: v.optional(v.union(v.string(), v.null())),
    kind: v.optional(v.union(v.literal('autonomous'), v.literal('supervised')))
  },
  returns: v.object({
    agentId: v.string(),
    created: v.boolean()
  }),
  handler: async (ctx, args) => {
    const orgCode = args.orgCode ?? null;

    // Guard against double-registration. If the agent already exists, keep it
    // idempotent but SYNC its scopes/allowedTools to the requested policy (so the
    // registered agent's action namespace matches what `authorize()` checks).
    const existing = await agentAuth.listAgents(ctx, {});
    const already = existing.find(
      (a) => a.kindeClientId === args.kindeClientId && a.orgCode === orgCode
    );
    if (already) {
      await agentAuth.setAgentPolicy(ctx, {
        agentId: already._id as GenericId<'agents'>,
        scopes: args.scopes,
        allowedTools: args.allowedTools
      });
      return {agentId: already._id, created: false};
    }

    const agentId = await agentAuth.registerAgent(ctx, {
      name: args.name,
      slug: args.slug,
      kind: args.kind ?? 'autonomous',
      ownerKind: orgCode ? 'org' : 'platform',
      orgCode,
      kindeClientId: args.kindeClientId,
      scopes: args.scopes,
      allowedTools: args.allowedTools
    });

    return {agentId, created: true};
  }
});
