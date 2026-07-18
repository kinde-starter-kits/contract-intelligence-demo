import {describe, test, expect} from 'vitest';
import {internal} from './_generated/api';
import {api} from './_generated/api';
import {initConvexTest} from './setup.test';

describe('schema: tables, indexes, and tenant isolation', () => {
  test('seedOrgFixture inserts an org, contract, clauses, and a review run', async () => {
    const t = initConvexTest();

    const seeded = await t.mutation(internal.seed.seedOrgFixture, {
      orgCode: 'org_acme',
      orgName: 'Acme',
      uploadedBy: 'kp_user_admin',
      actingSubject: 'kp_user_admin',
      mode: 'intersection'
    });

    expect(seeded.contractId).toBeDefined();
    expect(seeded.clauseIds).toHaveLength(2);
    expect(seeded.reviewRunId).toBeDefined();

    // The by_contract index returns the contract's clauses in order.
    const clauses = await t.query(api.contracts.listClausesByContract, {
      contractId: seeded.contractId
    });
    expect(clauses.map((c) => c.index)).toEqual([0, 1]);
    expect(clauses.every((c) => c.orgCode === 'org_acme')).toBe(true);

    // The review run is reachable by its contract via the by_contract index.
    const runs = await t.run(async (ctx) => {
      return await ctx.db
        .query('reviewRuns')
        .withIndex('by_contract', (q) => q.eq('contractId', seeded.contractId))
        .collect();
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].instanceId).toContain('org_acme');
  });

  test('by_orgCode_status index filters contracts by status within an org', async () => {
    const t = initConvexTest();

    await t.mutation(internal.seed.seedOrgFixture, {
      orgCode: 'org_acme',
      orgName: 'Acme',
      uploadedBy: 'kp_user_admin',
      actingSubject: 'kp_user_admin',
      mode: 'intersection'
    });
    // Add a second contract already marked reviewed.
    await t.run(async (ctx) => {
      await ctx.db.insert('contracts', {
        title: 'Acme NDA',
        orgCode: 'org_acme',
        uploadedBy: 'kp_user_analyst',
        status: 'reviewed',
        createdAt: Date.now()
      });
    });

    const uploaded = await t.query(api.contracts.listContractsByOrg, {
      orgCode: 'org_acme',
      status: 'uploaded'
    });
    const reviewed = await t.query(api.contracts.listContractsByOrg, {
      orgCode: 'org_acme',
      status: 'reviewed'
    });

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].status).toBe('uploaded');
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0].status).toBe('reviewed');
    expect(reviewed[0].title).toBe('Acme NDA');
  });

  // The isolation test that matters: a tenant-scoped query must never return
  // another org's rows, even with identical shapes seeded side by side.
  test('cross-org query does not leak rows from another orgCode', async () => {
    const t = initConvexTest();

    const acme = await t.mutation(internal.seed.seedOrgFixture, {
      orgCode: 'org_acme',
      orgName: 'Acme',
      uploadedBy: 'kp_user_acme',
      actingSubject: 'kp_user_acme',
      mode: 'intersection'
    });
    const globex = await t.mutation(internal.seed.seedOrgFixture, {
      orgCode: 'org_globex',
      orgName: 'Globex',
      uploadedBy: 'kp_user_globex',
      actingSubject: 'kp_user_globex',
      mode: 'broken'
    });

    const acmeContracts = await t.query(api.contracts.listContractsByOrg, {
      orgCode: 'org_acme'
    });

    // Acme sees exactly its own contract...
    expect(acmeContracts).toHaveLength(1);
    expect(acmeContracts[0]._id).toBe(acme.contractId);
    expect(acmeContracts.every((c) => c.orgCode === 'org_acme')).toBe(true);
    // ...and never Globex's, even though the row shape is identical.
    expect(acmeContracts.some((c) => c._id === globex.contractId)).toBe(false);
    expect(acmeContracts.some((c) => c.orgCode === 'org_globex')).toBe(false);

    // Symmetric check from Globex's side.
    const globexContracts = await t.query(api.contracts.listContractsByOrg, {
      orgCode: 'org_globex'
    });
    expect(globexContracts).toHaveLength(1);
    expect(globexContracts[0]._id).toBe(globex.contractId);
    expect(globexContracts.some((c) => c.orgCode === 'org_acme')).toBe(false);

    // The clauses index is likewise isolated: Acme's contract yields only
    // Acme's clauses.
    const acmeClauses = await t.query(api.contracts.listClausesByContract, {
      contractId: acme.contractId
    });
    expect(acmeClauses.every((c) => c.orgCode === 'org_acme')).toBe(true);

    // And a raw index scan over reviewRuns by org stays partitioned.
    const globexRuns = await t.run(async (ctx) => {
      return await ctx.db
        .query('reviewRuns')
        .withIndex('by_orgCode', (q) => q.eq('orgCode', 'org_globex'))
        .collect();
    });
    expect(globexRuns).toHaveLength(1);
    expect(globexRuns[0].mode).toBe('broken');
    expect(globexRuns[0].contractId).toBe(globex.contractId);
  });
});
