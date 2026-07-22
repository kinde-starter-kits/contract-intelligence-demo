import {internalMutation, query, MutationCtx} from './_generated/server';
import {v} from 'convex/values';
import {Id} from './_generated/dataModel';

export interface RunEventDetail {
  clauseId?: string;
  clauseIndex?: number;
  riskLevel?: string;
  status?: string;
  reason?: string;
  correlationId?: string;
}

/**
 * Append an event to a run (plain helper). Callable directly from mutations —
 * which cannot `runMutation` — as well as from the `emit` internalMutation that
 * the HTTP layer uses.
 */
export async function insertRunEvent(
  ctx: MutationCtx,
  args: {
    reviewRunId: Id<'reviewRuns'>;
    orgCode: string;
    type: string;
    message: string;
    detail?: RunEventDetail;
  }
): Promise<number> {
  const existing = await ctx.db
    .query('runEvents')
    .withIndex('by_reviewRun', (q) => q.eq('reviewRunId', args.reviewRunId))
    .collect();
  const seq = existing.length;
  await ctx.db.insert('runEvents', {
    reviewRunId: args.reviewRunId,
    orgCode: args.orgCode,
    seq,
    type: args.type,
    message: args.message,
    detail: args.detail,
    at: Date.now()
  });
  return seq;
}

/**
 * Live, ordered, persisted events for a review run. The app emits coarse events
 * from its mutations (run_started, clause_flagged, signoff_allowed/denied,
 * run_complete); the crew emits finer steps via the `/agent/event` endpoint
 * (extractor_started, clause_extracted, clause_assessed, signoff_attempted).
 * The client subscribes reactively (`listRunEvents`) to render them as they
 * happen, and can re-open a finished run because they're persisted.
 */

const eventDetail = v.object({
  clauseId: v.optional(v.string()),
  clauseIndex: v.optional(v.number()),
  riskLevel: v.optional(v.string()),
  status: v.optional(v.string()),
  reason: v.optional(v.string()),
  correlationId: v.optional(v.string())
});

/** Append an event to a run, assigning the next sequence number. */
export const emit = internalMutation({
  args: {
    reviewRunId: v.id('reviewRuns'),
    orgCode: v.string(),
    type: v.string(),
    message: v.string(),
    detail: v.optional(eventDetail)
  },
  returns: v.object({seq: v.number()}),
  handler: async (ctx, args) => {
    const seq = await insertRunEvent(ctx, args);
    return {seq};
  }
});

/** All events for a run, in order — the client subscribes to this. */
export const listRunEvents = query({
  args: {reviewRunId: v.id('reviewRuns')},
  returns: v.array(
    v.object({
      _id: v.id('runEvents'),
      seq: v.number(),
      type: v.string(),
      message: v.string(),
      detail: v.optional(eventDetail),
      at: v.number()
    })
  ),
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query('runEvents')
      .withIndex('by_reviewRun', (q) => q.eq('reviewRunId', args.reviewRunId))
      .collect();
    return events
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({
        _id: e._id,
        seq: e.seq,
        type: e.type,
        message: e.message,
        detail: e.detail,
        at: e.at
      }));
  }
});

/** The most recent review run for a contract (so the UI can subscribe to it). */
export const latestReviewRun = query({
  args: {contractId: v.id('contracts')},
  returns: v.union(
    v.object({
      _id: v.id('reviewRuns'),
      actingSubject: v.string(),
      mode: v.union(v.literal('broken'), v.literal('intersection')),
      status: v.union(
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed')
      ),
      startedAt: v.number()
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query('reviewRuns')
      .withIndex('by_contract', (q) => q.eq('contractId', args.contractId))
      .collect();
    if (runs.length === 0) return null;
    const latest = runs.sort((a, b) => b.startedAt - a.startedAt)[0];
    return {
      _id: latest._id,
      actingSubject: latest.actingSubject,
      mode: latest.mode,
      status: latest.status,
      startedAt: latest.startedAt
    };
  }
});
