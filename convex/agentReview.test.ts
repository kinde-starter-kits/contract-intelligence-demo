import {describe, test, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {internal} from './_generated/api';
import {initConvexTest} from './setup.test';

const acmeText = readFileSync(
  join(__dirname, '..', 'fixtures', 'acme-msa.txt'),
  'utf-8'
);

const ORG = 'org_acme';
const HUMAN = 'kp_user_admin';

async function setup(t: ReturnType<typeof initConvexTest>) {
  const {agentId} = await t.mutation(internal.agents.provisionAgent, {
    kindeClientId: 'm2m_crew',
    name: 'Contract Review Crew',
    slug: 'contract-review-crew',
    orgCode: ORG,
    scopes: ['contracts:read', 'clauses:flag', 'clauses:approve'],
    allowedTools: ['retrieve_clause', 'flag_clause', 'approve_clause']
  });
  const {contractId} = await t.mutation(internal.ingest.ingestContractText, {
    orgCode: ORG,
    uploadedBy: HUMAN,
    title: 'Acme MSA',
    text: acmeText
  });
  return {agentId, contractId};
}

describe('agent review endpoints (internal logic)', () => {
  test('startReview opens a component instance and records the run with acting subject + mode', async () => {
    const t = initConvexTest();
    const {agentId, contractId} = await setup(t);

    const {reviewRunId, instanceId} = await t.mutation(
      internal.agentReview.startReview,
      {
        agentId,
        orgCode: ORG,
        actingSubject: HUMAN,
        contractId,
        mode: 'intersection'
      }
    );
    expect(instanceId).toBeTruthy();

    const run = await t.run(async (ctx) => ctx.db.get(reviewRunId));
    expect(run?.actingSubject).toBe(HUMAN);
    expect(run?.mode).toBe('intersection');
    expect(run?.status).toBe('running');
    expect(run?.instanceId).toBe(instanceId);
  });

  test('flag + approve credit the acting subject and record the decision on the run', async () => {
    const t = initConvexTest();
    const {agentId, contractId} = await setup(t);
    const {reviewRunId, instanceId} = await t.mutation(
      internal.agentReview.startReview,
      {
        agentId,
        orgCode: ORG,
        actingSubject: HUMAN,
        contractId,
        mode: 'intersection'
      }
    );

    const clauses = await t.query(internal.agentReview.listClausesForAgent, {
      orgCode: ORG,
      contractId
    });
    expect(clauses.length).toBe(8);

    const flagged = await t.mutation(internal.agentReview.flagClause, {
      orgCode: ORG,
      actingSubject: HUMAN,
      reviewRunId,
      clauseId: clauses[4].clauseId, // "Limitation of Liability"
      riskLevel: 'high',
      rationale: 'Liability cap.'
    });
    expect(flagged.status).toBe('flagged');

    const approved = await t.mutation(internal.agentReview.approveClause, {
      orgCode: ORG,
      actingSubject: HUMAN,
      reviewRunId,
      clauseId: clauses[0].clauseId // preamble, low risk
    });
    expect(approved.status).toBe('approved');

    const [flaggedRow, approvedRow] = await t.run(async (ctx) => [
      await ctx.db.get(clauses[4].clauseId),
      await ctx.db.get(clauses[0].clauseId)
    ]);
    // Decisions are credited to the acting human, and tied to the run's instance.
    expect(flaggedRow?.riskLevel).toBe('high');
    expect(flaggedRow?.decidedBy).toBe(HUMAN);
    expect(flaggedRow?.decisionCorrelationId).toContain(instanceId);
    expect(approvedRow?.status).toBe('approved');
    expect(approvedRow?.decidedBy).toBe(HUMAN);
  });

  test('a review/clause in another org is rejected (tenant scoping)', async () => {
    const t = initConvexTest();
    const {agentId, contractId} = await setup(t);

    // Verified as a DIFFERENT org → cannot start a review on this contract.
    await expect(
      t.mutation(internal.agentReview.startReview, {
        agentId,
        orgCode: 'org_globex',
        actingSubject: 'kp_user_other',
        contractId,
        mode: 'intersection'
      })
    ).rejects.toThrow(/different org/);
  });

  test('completeReview closes the run', async () => {
    const t = initConvexTest();
    const {agentId, contractId} = await setup(t);
    const {reviewRunId} = await t.mutation(internal.agentReview.startReview, {
      agentId,
      orgCode: ORG,
      actingSubject: HUMAN,
      contractId,
      mode: 'intersection'
    });
    await t.mutation(internal.agentReview.completeReview, {
      orgCode: ORG,
      reviewRunId
    });
    const run = await t.run(async (ctx) => ctx.db.get(reviewRunId));
    expect(run?.status).toBe('completed');
    expect(run?.finishedAt).toBeTypeOf('number');
  });
});

describe('agent HTTP surface (auth gate)', () => {
  test('POST /agent/flag with no bearer token is rejected 401', async () => {
    const t = initConvexTest();
    const res = await t.fetch('/agent/flag', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({clauseId: 'x'})
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('missing_bearer_token');
  });

  test('POST /agent/review/start with no bearer token is rejected 401', async () => {
    const t = initConvexTest();
    const res = await t.fetch('/agent/review/start', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({contractId: 'x'})
    });
    expect(res.status).toBe(401);
  });
});
