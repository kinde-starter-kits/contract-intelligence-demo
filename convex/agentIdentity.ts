import {action, internalAction, internalQuery} from './_generated/server';
import {v} from 'convex/values';
import {agentAuth} from './agentAuth';

const verifiedIdentity = v.object({
  accepted: v.boolean(),
  subject: v.string(),
  agentId: v.union(v.string(), v.null()),
  orgCode: v.union(v.string(), v.null()),
  scopes: v.array(v.string())
});

/**
 * Read the agent-auth component's effective config. Used during setup to prove
 * the deployment is in the expected mode and that the live-mode audience guard
 * is real: in live mode with KINDE_AUDIENCE unset this THROWS
 * `kinde_audience_required_in_live` (fail-closed against cross-audience token
 * replay); once the audience is set it returns the config.
 *
 * Internal — a setup/diagnostics tool, not a client-facing surface.
 */
export const readComponentConfig = internalQuery({
  args: {},
  returns: v.object({
    domain: v.string(),
    audience: v.union(v.string(), v.null()),
    mode: v.union(v.literal('test'), v.literal('live')),
    jwksMaxAgeMs: v.number()
  }),
  handler: async (ctx) => {
    return await agentAuth.getConfig(ctx);
  }
});

/**
 * Verify a real Kinde M2M access token and resolve the calling agent, via the
 * component's stable `verifyCaller` seam. Runs as an action because verification
 * may refresh the JWKS cache (a network call), which queries/mutations can't do.
 *
 * `internal` on purpose: this is a provisioning/verification tool invoked from
 * the admin CLI (`npx convex run`) during setup, not an agent-facing endpoint.
 * The agent-facing surface (later phases) goes through `authorize()`, which
 * binds the verified caller to a specific run instance.
 *
 * Returns the non-secret parts of the verified identity (never the raw claims)
 * so it's safe to print during setup.
 */
export const verifyCrewToken = internalAction({
  args: {
    token: v.string(),
    // Org-scoped deployments should assert the expected org so the org
    // revocation and tenant-policy gates are never silently skipped.
    expectedOrgCode: v.optional(v.string())
  },
  returns: verifiedIdentity,
  handler: async (ctx, args) => {
    const verified = await agentAuth.verifyCaller(ctx, args.token, {
      expectedOrgCode: args.expectedOrgCode,
      // This deployment registers its agent, so require the caller to resolve
      // to a known agent (the component default) rather than allow-through.
      requireRegisteredAgent: true
    });
    return {
      accepted: true,
      subject: verified.subject,
      agentId: verified.agentId,
      orgCode: verified.orgCode,
      scopes: verified.scopes
    };
  }
});

/**
 * PUBLIC verification seam over the component's `verifyCaller`. Used by the
 * Next.js vector-similarity route (app/api/agent/similar), which runs where the
 * ONNX embedding runtime lives and can't call an internal Convex function.
 *
 * Safe to expose: `verifyCaller` only VERIFIES identity (and audits) — it makes
 * no authorization decision. The Convex httpActions (convex/http.ts) use the
 * internal `verifyCrewToken` directly; this mirrors it for the one endpoint that
 * must live in Next.js. Throws (rejects) on a missing/invalid/unregistered token.
 */
export const verifyAgentToken = action({
  args: {
    token: v.string(),
    expectedOrgCode: v.optional(v.string())
  },
  returns: verifiedIdentity,
  handler: async (ctx, args) => {
    const verified = await agentAuth.verifyCaller(ctx, args.token, {
      expectedOrgCode: args.expectedOrgCode,
      requireRegisteredAgent: true
    });
    return {
      accepted: true,
      subject: verified.subject,
      agentId: verified.agentId,
      orgCode: verified.orgCode,
      scopes: verified.scopes
    };
  }
});
