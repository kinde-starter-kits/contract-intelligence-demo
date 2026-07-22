import {describe, test, expect, vi, beforeEach} from 'vitest';

/**
 * Guest demo mode resolves a "view as ROLE" choice to a REAL, pre-provisioned
 * Kinde test user: the mapped subject + that user's permissions read LIVE from
 * the Kinde Management API. This is what makes enforcement genuine through the
 * switcher — the same subject then drives authorize() at the crew endpoints (see
 * convex/authzIntersection.test.ts, where that subject is denied/allowed for
 * real). Here we prove the mapping and the live grant resolution.
 */

const cookieStore = {value: undefined as string | undefined};

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'ci_guest_role' && cookieStore.value
        ? {value: cookieStore.value}
        : undefined
  })
}));

const managementPerms: Record<string, string[]> = {
  kp_intern: ['contracts:read'],
  kp_admin: ['contracts:read', 'clauses:flag', 'clauses:approve']
};

vi.mock('./kinde-management', () => ({
  isManagementConfigured: () => true,
  resolveOrgUserPermissions: async (_org: string, userId: string) =>
    managementPerms[userId] ?? []
}));

vi.mock('./kinde', () => ({
  resolveSessionPermissions: async () => ({
    authenticated: false,
    orgCode: null,
    userId: null,
    email: null,
    granted: {}
  })
}));

import {getActingIdentity} from './acting-identity';

beforeEach(() => {
  cookieStore.value = undefined;
  process.env.DEMO_ORG_CODE = 'org_demo';
  process.env.DEMO_INTERN_SUBJECT = 'kp_intern';
  process.env.DEMO_ANALYST_SUBJECT = 'kp_analyst';
  process.env.DEMO_ADMIN_SUBJECT = 'kp_admin';
});

describe('getActingIdentity — guest demo mode', () => {
  test('a guest "intern" maps to the real intern subject with a read-only grant', async () => {
    cookieStore.value = 'intern';
    const id = await getActingIdentity();

    expect(id.kind).toBe('guest');
    expect(id.role).toBe('intern');
    expect(id.subject).toBe('kp_intern'); // real, pre-provisioned Kinde user id
    expect(id.orgCode).toBe('org_demo');
    // Grants come from Kinde, not from the client — intern cannot approve.
    expect(id.granted['contracts:read']).toBe(true);
    expect(id.granted['clauses:approve']).toBe(false);
  });

  test('a guest "admin" maps to the real admin subject with full grants', async () => {
    cookieStore.value = 'admin';
    const id = await getActingIdentity();

    expect(id.subject).toBe('kp_admin');
    expect(id.granted['clauses:approve']).toBe(true);
  });

  test('no cookie and no Kinde session resolves to none (guest never invented)', async () => {
    const id = await getActingIdentity();
    expect(id.kind).toBe('none');
    expect(id.subject).toBeNull();
  });
});
