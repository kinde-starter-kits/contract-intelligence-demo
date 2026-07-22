import {GenericId} from 'convex/values';
import {ActionCtx} from './_generated/server';
import {agentAuth} from './agentAuth';

/**
 * The app's authorization mode for agent actions.
 *
 *   broken       — authorize on the AGENT's identity alone. The acting human's
 *                  permissions are never resolved or checked. This is the
 *                  confused deputy: a read-only human's proxy can do things the
 *                  human never could. (Phase 5.)
 *   intersection — authorize on the acting human's permissions ∩ the agent's,
 *                  via the component's `authorize()`. The human's ceiling always
 *                  applies. (Phase 6.)
 */
export type AuthzMode = 'broken' | 'intersection';

/**
 * The mode is decided by the SERVER (deployment env `AUTHZ_MODE`), never by the
 * calling agent — a client must not be able to pick how strictly it is checked.
 * Defaults to `broken`. Flip with `npx convex env set AUTHZ_MODE broken|intersection`.
 */
export function resolveAuthzMode(): AuthzMode {
  return process.env.AUTHZ_MODE === 'intersection' ? 'intersection' : 'broken';
}

/**
 * DEMO-ONLY escape hatch. When `DEMO_MODE_SELECTABLE=true` on the deployment,
 * the trusted demo operator may pick the mode PER RUN (so a visitor can watch
 * the problem AND the fix without a redeploy). It is OFF by default, and in a
 * real deployment it stays off: there, the mode is `AUTHZ_MODE` alone and the
 * calling agent can never choose how strictly it is checked.
 */
export function isDemoModeSelectable(): boolean {
  return process.env.DEMO_MODE_SELECTABLE === 'true';
}

/**
 * The effective mode for a review run: the demo operator's requested mode when
 * mode-selection is enabled AND the request names a valid mode; otherwise the
 * server's `AUTHZ_MODE`.
 */
export function resolveRunMode(requested: unknown): AuthzMode {
  if (
    isDemoModeSelectable() &&
    (requested === 'broken' || requested === 'intersection')
  ) {
    return requested;
  }
  return resolveAuthzMode();
}

export interface AuthzDecision {
  mode: AuthzMode;
  allowed: boolean;
  /** Whether the acting human's permissions were consulted at all. */
  humanChecked: boolean;
  reason: string;
  /** The component's audit correlation id (intersection mode). */
  correlationId: string | null;
  /** Scopes the action needs, when denied for scope (intersection mode). */
  requiredScopes: string[];
}

/**
 * Authorize an agent action (`clauses:flag`, `clauses:approve`) taken on behalf
 * of the acting human, for a specific run instance.
 *
 * Runs at the HTTP/action layer because it needs the crew's verified token and
 * (in intersection mode) may refresh the JWKS cache.
 *
 *   broken       — the action is authorized on the agent's verified token alone;
 *                  the acting human's permissions are NEVER consulted.
 *   intersection — the component's `authorize(token, {instanceId, action})`
 *                  decides: human ∩ agent (∩ live token scopes via
 *                  `enforceTokenScopes`). We use `authorize()` (which binds the
 *                  verified caller to the instance) — never raw `authz.can`.
 *                  A denial returns `allowed:false` with a machine-readable
 *                  reason + correlationId; the component writes the audit row.
 */
export async function authorizeAgentAction(
  ctx: ActionCtx,
  token: string,
  opts: {mode: AuthzMode; instanceId: string; action: string}
): Promise<AuthzDecision> {
  if (opts.mode === 'broken') {
    return {
      mode: 'broken',
      allowed: true,
      humanChecked: false,
      reason: `broken: authorized on the agent's identity alone; the acting human's authority for '${opts.action}' was never checked`,
      correlationId: null,
      requiredScopes: []
    };
  }

  const {decision} = await agentAuth.authorize(ctx, token, {
    instanceId: opts.instanceId as GenericId<'instances'>,
    action: opts.action,
    // Intersect the crew's LIVE token scopes in too, so a shrunk M2M scope set
    // takes effect immediately and can't drift from the registered agent scopes.
    enforceTokenScopes: true
  });

  return {
    mode: 'intersection',
    allowed: decision.allowed,
    humanChecked: true,
    reason: decision.reason,
    correlationId: decision.correlationId,
    requiredScopes: decision.requiredScopes ?? []
  };
}
