import {query} from './_generated/server';
import {v} from 'convex/values';

/**
 * List contracts for one org, newest first. Tenant-scoped by `orgCode` via the
 * `by_orgCode` index so it can never return another org's rows. Optionally
 * filter by status using the composite `by_orgCode_status` index.
 *
 * This is a minimal, read-only helper to prove the schema is queryable — real
 * access control (who may call this, for which org) is wired up in a later
 * phase.
 */
export const listContractsByOrg = query({
  args: {
    orgCode: v.string(),
    status: v.optional(
      v.union(
        v.literal('uploaded'),
        v.literal('reviewing'),
        v.literal('reviewed')
      )
    )
  },
  returns: v.array(
    v.object({
      _id: v.id('contracts'),
      _creationTime: v.number(),
      title: v.string(),
      orgCode: v.string(),
      storageId: v.optional(v.id('_storage')),
      uploadedBy: v.string(),
      status: v.union(
        v.literal('uploaded'),
        v.literal('reviewing'),
        v.literal('reviewed')
      ),
      createdAt: v.number()
    })
  ),
  handler: async (ctx, args) => {
    if (args.status !== undefined) {
      const status = args.status;
      return await ctx.db
        .query('contracts')
        .withIndex('by_orgCode_status', (q) =>
          q.eq('orgCode', args.orgCode).eq('status', status)
        )
        .order('desc')
        .collect();
    }

    return await ctx.db
      .query('contracts')
      .withIndex('by_orgCode', (q) => q.eq('orgCode', args.orgCode))
      .order('desc')
      .collect();
  }
});

/** Title + status for one contract (for the review stage header). */
export const getContractMeta = query({
  args: {contractId: v.id('contracts')},
  returns: v.union(
    v.object({
      _id: v.id('contracts'),
      title: v.string(),
      orgCode: v.string(),
      status: v.union(
        v.literal('uploaded'),
        v.literal('reviewing'),
        v.literal('reviewed')
      )
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.contractId);
    if (!c) return null;
    return {_id: c._id, title: c.title, orgCode: c.orgCode, status: c.status};
  }
});

/**
 * List the clauses of a contract in clause order. Scoped by `contractId`;
 * callers pass `orgCode` so this can be tenant-checked once access control
 * lands.
 */
export const listClausesByContract = query({
  args: {
    contractId: v.id('contracts')
  },
  returns: v.array(
    v.object({
      _id: v.id('clauses'),
      _creationTime: v.number(),
      contractId: v.id('contracts'),
      orgCode: v.string(),
      index: v.number(),
      text: v.string(),
      riskLevel: v.union(
        v.literal('unassessed'),
        v.literal('low'),
        v.literal('medium'),
        v.literal('high'),
        v.literal('critical')
      ),
      status: v.union(
        v.literal('pending'),
        v.literal('flagged'),
        v.literal('approved')
      ),
      decidedBy: v.optional(v.string()),
      decisionCorrelationId: v.optional(v.string()),
      decidedAt: v.optional(v.number())
    })
  ),
  handler: async (ctx, args) => {
    const clauses = await ctx.db
      .query('clauses')
      .withIndex('by_contract', (q) => q.eq('contractId', args.contractId))
      .collect();
    return clauses.sort((a, b) => a.index - b.index);
  }
});
