import {internalMutation, internalQuery} from './_generated/server';
import {v, GenericId} from 'convex/values';
import {Id} from './_generated/dataModel';
import {agentAuth} from './agentAuth';
import {insertRunEvent} from './runEvents';

/**
 * Internal host-app logic behind the crew's HTTP endpoints (convex/http.ts).
 *
 * These are `internal*` — the HTTP layer authenticates the crew's token via the
 * component's verifyCaller FIRST, then calls these with the already-verified
 * `agentId` / `orgCode` and the acting human's `actingSubject`. Nothing here is
 * publicly callable.
 *
 * AUTHORIZATION happens at the HTTP/action layer (authorizeAgentAction, which
 * needs the crew token) BEFORE these run: broken mode allows on the agent's
 * identity alone; intersection mode calls the component's `authorize()` for
 * human ∩ agent and only reaches flag/approve when allowed. These mutations
 * record the decision for provenance.
 */

const clauseRiskLevel = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high')
);

// The authorization decision computed at the HTTP/action layer
// (authorizeAgentAction). flag/approve only run after `allowed === true`; they
// record the decision for provenance.
const authzDecision = v.object({
  mode: v.union(v.literal('broken'), v.literal('intersection')),
  allowed: v.boolean(),
  humanChecked: v.boolean(),
  reason: v.string(),
  correlationId: v.union(v.string(), v.null()),
  requiredScopes: v.array(v.string())
});

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
    instanceId: v.string(),
    mode: v.union(v.literal('broken'), v.literal('intersection'))
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
    await insertRunEvent(ctx, {
      reviewRunId,
      orgCode: args.orgCode,
      type: 'run_started',
      message: `Review run started (mode: ${args.mode}) for ${args.actingSubject}.`
    });

    return {reviewRunId, instanceId, mode: args.mode};
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

/** Fetch a review run's instance id + mode for the HTTP authorization layer. */
export const getReviewRun = internalQuery({
  args: {reviewRunId: v.id('reviewRuns'), orgCode: v.string()},
  returns: v.union(
    v.object({
      instanceId: v.string(),
      mode: v.union(v.literal('broken'), v.literal('intersection'))
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.reviewRunId);
    if (!run || run.orgCode !== args.orgCode) return null;
    return {instanceId: run.instanceId, mode: run.mode};
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
    rationale: v.string(),
    // The decision from authorizeAgentAction (HTTP layer). Only reached when
    // allowed; recorded for provenance.
    authz: authzDecision
  },
  returns: v.object({
    clauseId: v.id('clauses'),
    riskLevel: clauseRiskLevel,
    status: v.literal('flagged'),
    authz: authzDecision
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
      decisionCorrelationId:
        args.authz.correlationId ?? `${run.instanceId}:flag:${args.clauseId}`,
      decidedAt: Date.now()
    });
    await insertRunEvent(ctx, {
      reviewRunId: args.reviewRunId,
      orgCode: args.orgCode,
      type: 'clause_flagged',
      message: `Clause ${clause.index} flagged ${args.riskLevel} risk.`,
      detail: {
        clauseId: args.clauseId,
        clauseIndex: clause.index,
        riskLevel: args.riskLevel
      }
    });
    return {
      clauseId: args.clauseId,
      riskLevel: args.riskLevel,
      status: 'flagged' as const,
      authz: args.authz
    };
  }
});

/** Approve a clause, credited to the acting human. */
export const approveClause = internalMutation({
  args: {
    orgCode: v.string(),
    actingSubject: v.string(),
    reviewRunId: v.id('reviewRuns'),
    clauseId: v.id('clauses'),
    authz: authzDecision
  },
  returns: v.object({
    clauseId: v.id('clauses'),
    status: v.literal('approved'),
    authz: authzDecision
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
      decisionCorrelationId:
        args.authz.correlationId ??
        `${run.instanceId}:approve:${args.clauseId}`,
      decidedAt: Date.now()
    });
    await insertRunEvent(ctx, {
      reviewRunId: args.reviewRunId,
      orgCode: args.orgCode,
      type: 'signoff_allowed',
      message: `Clause ${clause.index} approved (${args.authz.mode}).`,
      detail: {
        clauseId: args.clauseId,
        clauseIndex: clause.index,
        status: 'approved',
        correlationId: args.authz.correlationId ?? undefined
      }
    });
    return {
      clauseId: args.clauseId,
      status: 'approved' as const,
      authz: args.authz
    };
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
    await insertRunEvent(ctx, {
      reviewRunId: args.reviewRunId,
      orgCode: args.orgCode,
      type: 'run_complete',
      message: 'Review run complete.'
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
    mode: 'broken' | 'intersection';
  } | null;
  if (!run) throw new Error('Review run not found.');
  if (run.orgCode !== orgCode) {
    throw new Error('Review run belongs to a different org.');
  }
  return run;
}
