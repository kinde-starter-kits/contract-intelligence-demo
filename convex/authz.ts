import {ConvexError} from 'convex/values';

/**
 * The app's authorization mode for agent actions.
 *
 *   broken       — authorize on the AGENT's identity alone. The acting human's
 *                  permissions are never resolved or checked. This is the
 *                  confused deputy: a read-only human's proxy can do things the
 *                  human never could. (Phase 5.)
 *   intersection — authorize on crew capabilities ∩ the acting human's
 *                  permissions, so the human's ceiling always applies. (Phase 6.)
 */
export type AuthzMode = 'broken' | 'intersection';

/**
 * The mode is decided by the SERVER (deployment env `AUTHZ_MODE`), never by the
 * calling agent — a client must not be able to pick how strictly it is checked.
 * Defaults to `broken` (the only mode implemented until phase 6). Flip it with
 * `npx convex env set AUTHZ_MODE broken|intersection`.
 */
export function resolveAuthzMode(): AuthzMode {
  return process.env.AUTHZ_MODE === 'intersection' ? 'intersection' : 'broken';
}

export interface AuthzDecision {
  mode: AuthzMode;
  allowed: boolean;
  /** Whether the acting human's permissions were consulted at all. */
  humanChecked: boolean;
  reason: string;
}

/**
 * Authorize an agent decision (e.g. `clauses:flag`, `clauses:approve`) taken on
 * behalf of the acting human.
 *
 * PHASE 5 — BROKEN ONLY. In broken mode the action is authorized on the agent's
 * verified identity alone (the token was already verified upstream); the acting
 * human's permissions are NEVER resolved or checked — that absence is the whole
 * bug. Intersection mode (crew capabilities ∩ the human's permissions) is
 * implemented in phase 6; until then it fails closed rather than pretend to
 * enforce.
 */
export function authorizeAgentDecision(
  mode: AuthzMode,
  action: string
): AuthzDecision {
  if (mode === 'broken') {
    return {
      mode,
      allowed: true,
      humanChecked: false,
      reason: `broken: authorized on the agent's identity alone; the acting human's authority for '${action}' was never checked`
    };
  }
  throw new ConvexError({
    code: 'intersection_not_implemented',
    message:
      'AUTHZ_MODE=intersection is implemented in phase 6; only broken mode is available.'
  });
}
