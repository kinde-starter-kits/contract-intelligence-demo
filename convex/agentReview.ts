import {internalMutation, internalQuery} from './_generated/server';
import {v, GenericId} from 'convex/values';
import {Id} from './_generated/dataModel';
import {agentAuth} from './agentAuth';

/**
 * Internal host-app logic behind the crew's HTTP endpoints (convex/http.ts).
 *
 * These are `internal*` — the HTTP layer authenticates the crew's token via the
 * component's verifyCaller FIRST, then calls these with the already-verified
 * `agentId` / `orgCode` and the acting human's `actingSubject`. Nothing here is
 * publicly callable.
 *
 * PHASE 4 SCOPE: happy path only. Every action is bound to a review run and the
 * acting subject; `mode` is recorded but NOT enforced. The authorization
 * decision (crew scopes ∩ the human's delegated permissions) arrives in the
 * authz phases and will key off exactly this `instanceId` + `actingSubject`.
 */

const clauseRiskLevel = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high')
);

/** Open a review run: start a component instance and record the run. */
export const startReview = internalMutation({
  args: {
    agentId: v.string(),
    orgCode: v.string(),
    actingSubject: v.string(),
    contractId: v.id('contracts'),
    mode: v.union(v.literal('broken'), v.literal('intersection'))
  },
  returns: v.object({
    reviewRunId: v.id('reviewRuns'),
    instanceId: v.string()
  }),
  handler: async (ctx, args) => {
    const contract = await ctx.db.get(args.contractId);
    if (!contract) throw new Error('Contract not found.');
    if (contract.orgCode !== args.orgCode) {
      throw new Error('Contract belongs to a different org.');
    }

    const now = Date.now();
    const runId = `review_${args.contractId}_${now}`;
    // Open a real agent-auth run instance so later phases can authorize actions
    // against it (authorize(token, {instanceId, action})).
    const instanceId = await agentAuth.startInstance(ctx, {
      // `agents` is a component table (not in our schema), so brand the verified
      // agent id as the component's expected id type.
      agentId: args.agentId as GenericId<'agents'>,
      runId,
      expiresAt: now + 60 * 60 * 1000, // 1 hour
      orgCode: args.orgCode,
      actingForSubject: args.actingSubject
    });

    const reviewRunId = await ctx.db.insert('reviewRuns', {
      contractId: args.contractId,
      orgCode: args.orgCode,
      instanceId,
      actingSubject: args.actingSubject,
      mode: args.mode,
      status: 'running',
      startedAt: now
    });

    return {reviewRunId, instanceId};
  }
});

/** List a contract's clauses (tenant-scoped) for the crew's Clause Extractor. */
export const listClausesForAgent = internalQuery({
  args: {
    orgCode: v.string(),
    contractId: v.id('contracts')
  },
  returns: v.array(
    v.object({
      clauseId: v.id('clauses'),
      index: v.number(),
      text: v.string(),
      riskLevel: v.union(
        v.literal('unassessed'),
        v.literal('low'),
        v.literal('medium'),
        v.literal('high')
      ),
      status: v.union(
        v.literal('pending'),
        v.literal('flagged'),
        v.literal('approved')
      )
    })
  ),
  handler: async (ctx, args) => {
    const contract = await ctx.db.get(args.contractId);
    if (!contract) throw new Error('Contract not found.');
    if (contract.orgCode !== args.orgCode) {
      throw new Error('Contract belongs to a different org.');
    }
    const clauses = await ctx.db
      .query('clauses')
      .withIndex('by_contract', (q) => q.eq('contractId', args.contractId))
      .collect();
    return clauses
      .sort((a, b) => a.index - b.index)
      .map((c) => ({
        clauseId: c._id,
        index: c.index,
        text: c.text,
        riskLevel: c.riskLevel,
        status: c.status
      }));
  }
});

/** Flag a clause with a risk level + rationale, credited to the acting human. */
export const flagClause = internalMutation({
  args: {
    orgCode: v.string(),
    actingSubject: v.string(),
    reviewRunId: v.id('reviewRuns'),
    clauseId: v.id('clauses'),
    riskLevel: clauseRiskLevel,
    rationale: v.string()
  },
  returns: v.object({
    clauseId: v.id('clauses'),
    riskLevel: clauseRiskLevel,
    status: v.literal('flagged')
  }),
  handler: async (ctx, args) => {
    const run = await validateRun(ctx, args.reviewRunId, args.orgCode);
    const clause = await ctx.db.get(args.clauseId);
    if (!clause) throw new Error('Clause not found.');
    if (clause.orgCode !== args.orgCode) {
      throw new Error('Clause belongs to a different org.');
    }

    await ctx.db.patch(args.clauseId, {
      riskLevel: args.riskLevel,
      status: 'flagged',
      decidedBy: args.actingSubject,
      decisionCorrelationId: `${run.instanceId}:flag:${args.clauseId}`,
      decidedAt: Date.now()
    });
    return {
      clauseId: args.clauseId,
      riskLevel: args.riskLevel,
      status: 'flagged' as const
    };
  }
});

/** Approve a clause, credited to the acting human. */
export const approveClause = internalMutation({
  args: {
    orgCode: v.string(),
    actingSubject: v.string(),
    reviewRunId: v.id('reviewRuns'),
    clauseId: v.id('clauses')
  },
  returns: v.object({
    clauseId: v.id('clauses'),
    status: v.literal('approved')
  }),
  handler: async (ctx, args) => {
    const run = await validateRun(ctx, args.reviewRunId, args.orgCode);
    const clause = await ctx.db.get(args.clauseId);
    if (!clause) throw new Error('Clause not found.');
    if (clause.orgCode !== args.orgCode) {
      throw new Error('Clause belongs to a different org.');
    }

    await ctx.db.patch(args.clauseId, {
      status: 'approved',
      decidedBy: args.actingSubject,
      decisionCorrelationId: `${run.instanceId}:approve:${args.clauseId}`,
      decidedAt: Date.now()
    });
    return {clauseId: args.clauseId, status: 'approved' as const};
  }
});

/** Close a review run. */
export const completeReview = internalMutation({
  args: {
    orgCode: v.string(),
    reviewRunId: v.id('reviewRuns')
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await validateRun(ctx, args.reviewRunId, args.orgCode);
    await ctx.db.patch(args.reviewRunId, {
      status: 'completed',
      finishedAt: Date.now()
    });
    return null;
  }
});

async function validateRun(
  ctx: {db: {get: (id: Id<'reviewRuns'>) => Promise<unknown>}},
  reviewRunId: Id<'reviewRuns'>,
  orgCode: string
) {
  const run = (await ctx.db.get(reviewRunId)) as {
    orgCode: string;
    instanceId: string;
  } | null;
  if (!run) throw new Error('Review run not found.');
  if (run.orgCode !== orgCode) {
    throw new Error('Review run belongs to a different org.');
  }
  return run;
}
