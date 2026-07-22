import {cookies} from 'next/headers';
import {resolveSessionPermissions} from './kinde';
import {
  resolveOrgUserPermissions,
  isManagementConfigured
} from './kinde-management';
import {ALL_PERMISSIONS, PermissionKey} from './permissions';

/**
 * The acting identity for the current request, resolved server-side. Two ways
 * in, both REAL Kinde users — never a fake/bypassed session:
 *
 *  - GUEST demo mode: a "view as Intern/Analyst/Admin" switcher sets a cookie
 *    naming a role; the server maps it to that role's PRE-PROVISIONED Kinde test
 *    user (subject from env) and resolves that user's permissions LIVE from the
 *    Kinde Management API. The acting subject is a real Kinde user id, so all
 *    existing enforcement (authorize(), Management-API resolution at review-start)
 *    runs genuinely. The only thing skipped is the interactive password login —
 *    UX convenience, not a simulated session.
 *  - The real Kinde login ("sign in as yourself") stays available and takes
 *    precedence is NOT assumed — the guest cookie wins while set; clearing it
 *    falls back to the signed-in session.
 *
 * Test-user subjects come from env (config, not secrets); their credentials are
 * never involved and never reach the client.
 */

export const GUEST_ROLES = ['intern', 'analyst', 'admin'] as const;
export type GuestRole = (typeof GUEST_ROLES)[number];
export const GUEST_COOKIE = 'ci_guest_role';

export function isGuestRole(value: string | undefined): value is GuestRole {
  return !!value && (GUEST_ROLES as readonly string[]).includes(value);
}

function guestSubject(role: GuestRole): string | undefined {
  const map: Record<GuestRole, string | undefined> = {
    intern: process.env.DEMO_INTERN_SUBJECT,
    analyst: process.env.DEMO_ANALYST_SUBJECT,
    admin: process.env.DEMO_ADMIN_SUBJECT
  };
  return map[role];
}

export interface ActingIdentity {
  kind: 'guest' | 'kinde' | 'none';
  subject: string | null;
  orgCode: string | null;
  label: string | null;
  role: GuestRole | null;
  granted: Record<PermissionKey, boolean>;
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

async function grantedFromKinde(
  orgCode: string,
  subject: string
): Promise<Record<PermissionKey, boolean>> {
  const granted = emptyGrant();
  if (!isManagementConfigured()) return granted;
  try {
    const perms = await resolveOrgUserPermissions(orgCode, subject);
    for (const key of ALL_PERMISSIONS) granted[key] = perms.includes(key);
  } catch {
    // Leave empty on a resolution failure; the crew-side enforcement still runs.
  }
  return granted;
}

export async function getActingIdentity(): Promise<ActingIdentity> {
  const jar = await cookies();
  const roleCookie = jar.get(GUEST_COOKIE)?.value;

  if (isGuestRole(roleCookie)) {
    const subject = guestSubject(roleCookie);
    const orgCode = process.env.DEMO_ORG_CODE ?? null;
    if (subject && orgCode) {
      return {
        kind: 'guest',
        subject,
        orgCode,
        label: `Guest · ${roleCookie}`,
        role: roleCookie,
        granted: await grantedFromKinde(orgCode, subject)
      };
    }
  }

  const session = await resolveSessionPermissions();
  if (session.authenticated && session.orgCode && session.userId) {
    return {
      kind: 'kinde',
      subject: session.userId,
      orgCode: session.orgCode,
      label: session.email ?? session.userId,
      role: null,
      granted: session.granted
    };
  }

  return {
    kind: 'none',
    subject: null,
    orgCode: null,
    label: null,
    role: null,
    granted: emptyGrant()
  };
}
