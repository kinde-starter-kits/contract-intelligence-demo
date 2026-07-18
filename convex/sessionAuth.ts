import {Auth} from 'convex/server';

/**
 * Resolve the signed-in human from the verified Convex identity (the Kinde JWT
 * validated per convex/auth.config.ts). Returns the subject (Kinde user id) and
 * the org the session is scoped to. Throws if unauthenticated or org-less.
 *
 * This is the server-side enforcement point: identity comes from the verified
 * token, never from client input. Fine-grained permission checks (who may flag
 * / approve) land in the authz phases; here we only bind uploads to the caller.
 */
export async function requireHumanOrg(ctx: {auth: Auth}): Promise<{
  subject: string;
  orgCode: string;
}> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('Not authenticated.');
  }
  // Kinde carries the org on the `org_code` claim; surfaced via the identity's
  // index signature.
  const orgCode =
    typeof identity.org_code === 'string' ? identity.org_code : null;
  if (!orgCode) {
    throw new Error('No organization in session (org_code claim missing).');
  }
  return {subject: identity.subject, orgCode};
}
