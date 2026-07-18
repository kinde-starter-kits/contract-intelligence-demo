import {getKindeServerSession} from '@kinde-oss/kinde-auth-nextjs/server';
import {ALL_PERMISSIONS, PermissionKey} from './permissions';

/**
 * Resolve, from the verified Kinde server session, which of this app's
 * permissions the current human actually holds — read straight off the token,
 * not inferred from a role. Also returns the org the session is scoped to.
 *
 * This is the app's read of "what can this human do", used by server components
 * and (later) mutations. Enforcement is: check the permission, never the role.
 */
export async function resolveSessionPermissions(): Promise<{
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  orgCode: string | null;
  granted: Record<PermissionKey, boolean>;
}> {
  const {getUser, getPermission, getOrganization, isAuthenticated} =
    getKindeServerSession();

  const authed = await isAuthenticated();
  if (!authed) {
    return {
      authenticated: false,
      userId: null,
      email: null,
      orgCode: null,
      granted: emptyGrant()
    };
  }

  const user = await getUser();
  const org = await getOrganization();

  const granted = emptyGrant();
  for (const key of ALL_PERMISSIONS) {
    const perm = await getPermission(key);
    granted[key] = perm?.isGranted ?? false;
  }

  return {
    authenticated: true,
    userId: user?.id ?? null,
    email: user?.email ?? null,
    orgCode: org?.orgCode ?? null,
    granted
  };
}

function emptyGrant(): Record<PermissionKey, boolean> {
  return ALL_PERMISSIONS.reduce(
    (acc, key) => {
      acc[key] = false;
      return acc;
    },
    {} as Record<PermissionKey, boolean>
  );
}
