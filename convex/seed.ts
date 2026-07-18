import {internalMutation} from './_generated/server';
import {v} from 'convex/values';

/**
 * Seed a self-contained fixture for one org: the organization row, one
 * contract, two clauses, and a review run over that contract. Returns the ids
 * so callers (tests, local dev) can assert against them.
 *
 * Internal-only — not exposed to any client. Feature mutations with real auth
 * come in later phases.
 */
export const seedOrgFixture = internalMutation({
  args: {
    orgCode: v.string(),
    orgName: v.string(),
    uploadedBy: v.string(),
    actingSubject: v.string(),
    mode: v.union(v.literal('broken'), v.literal('intersection'))
  },
  returns: v.object({
    organizationId: v.id('organizations'),
    contractId: v.id('contracts'),
    clauseIds: v.array(v.id('clauses')),
    reviewRunId: v.id('reviewRuns')
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    const organizationId = await ctx.db.insert('organizations', {
      orgCode: args.orgCode,
      name: args.orgName
    });

    const contractId = await ctx.db.insert('contracts', {
      title: `${args.orgName} Master Services Agreement`,
      orgCode: args.orgCode,
      uploadedBy: args.uploadedBy,
      status: 'uploaded',
      createdAt: now
    });

    const clauseSeeds = [
      {index: 0, text: 'Either party may terminate with 30 days notice.'},
      {
        index: 1,
        text: 'Liability is capped at fees paid in the prior 12 months.'
      }
    ];
    const clauseIds = [];
    for (const c of clauseSeeds) {
      const id = await ctx.db.insert('clauses', {
        contractId,
        orgCode: args.orgCode,
        index: c.index,
        text: c.text,
        riskLevel: 'unassessed',
        status: 'pending'
      });
      clauseIds.push(id);
    }

    const reviewRunId = await ctx.db.insert('reviewRuns', {
      contractId,
      orgCode: args.orgCode,
      instanceId: `instance_${args.orgCode}_${now}`,
      actingSubject: args.actingSubject,
      mode: args.mode,
      status: 'running',
      startedAt: now
    });

    return {organizationId, contractId, clauseIds, reviewRunId};
  }
});
