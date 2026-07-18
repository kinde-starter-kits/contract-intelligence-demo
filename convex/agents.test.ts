import {describe, test, expect} from 'vitest';
import {internal} from './_generated/api';
import {initConvexTest} from './setup.test';
import * as agentsModule from './agents';
import * as contractsModule from './contracts';

// Convex tags every registered function with its visibility. Internal functions
// carry `isInternal: true` and are omitted from the public API surface the
// server exposes to clients; public ones carry `isPublic: true`.
type Visibility = {isInternal?: boolean; isPublic?: boolean};

describe('host wrappers: agent provisioning', () => {
  test('provisionAgent registers the crew M2M client id as an agent', async () => {
    const t = initConvexTest();

    const result = await t.mutation(internal.agents.provisionAgent, {
      kindeClientId: 'm2m_crew_client_abc',
      name: 'Contract Review Crew',
      slug: 'contract-review-crew',
      orgCode: 'org_acme',
      scopes: ['contracts:read', 'clauses:flag', 'clauses:approve'],
      allowedTools: ['retrieve_clause', 'flag_clause', 'approve_clause']
    });

    expect(result.created).toBe(true);
    expect(result.agentId).toBeTruthy();

    // The agent is now findable by its Kinde client id, with the crew's scopes.
    const found = await t.query(internal.agents.getAgentByClientId, {
      kindeClientId: 'm2m_crew_client_abc',
      orgCode: 'org_acme'
    });
    expect(found).not.toBeNull();
    expect(found?.agentId).toBe(result.agentId);
    expect(found?.scopes).toEqual([
      'contracts:read',
      'clauses:flag',
      'clauses:approve'
    ]);
    expect(found?.orgCode).toBe('org_acme');
  });

  test('provisionAgent is idempotent — a second call does not double-register', async () => {
    const t = initConvexTest();

    const first = await t.mutation(internal.agents.provisionAgent, {
      kindeClientId: 'm2m_crew_client_abc',
      name: 'Contract Review Crew',
      slug: 'contract-review-crew',
      orgCode: 'org_acme',
      scopes: ['contracts:read'],
      allowedTools: ['retrieve_clause']
    });
    const second = await t.mutation(internal.agents.provisionAgent, {
      kindeClientId: 'm2m_crew_client_abc',
      name: 'Contract Review Crew',
      slug: 'contract-review-crew',
      orgCode: 'org_acme',
      scopes: ['contracts:read'],
      allowedTools: ['retrieve_clause']
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.agentId).toBe(first.agentId);
  });

  // The security-model guarantee: provisioning is admin-only. Both agent
  // wrappers are registered `internal*`, so the server never exposes them on
  // the public API a client can call — only other Convex functions or the admin
  // CLI can reach them.
  test('provisionAgent is registered internal-only, not on the public surface', () => {
    const provision = agentsModule.provisionAgent as Visibility;
    const lookup = agentsModule.getAgentByClientId as Visibility;
    // Registered internal — never public.
    expect(provision.isInternal).toBe(true);
    expect(provision.isPublic).toBeUndefined();
    expect(lookup.isInternal).toBe(true);
    expect(lookup.isPublic).toBeUndefined();

    // A genuinely public host query, by contrast, is exposed to clients.
    const publicQuery = contractsModule.listContractsByOrg as Visibility;
    expect(publicQuery.isPublic).toBe(true);

    // It is still reachable via the `internal` reference (for CLI / other
    // functions), just not the public one.
    expect(internal.agents.provisionAgent).toBeDefined();
  });
});
