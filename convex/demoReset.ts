import {internalMutation} from './_generated/server';
import {v} from 'convex/values';

/**
 * Delete an org's contracts, clauses, and review runs — a clean slate for a
 * fresh demo walkthrough. Internal + admin-only (via `npx convex run`).
 *
 * Why a reset script rather than having the repros clean up after themselves:
 * the repros are the article's EVIDENCE (they must leave the failure/fix
 * outcomes on the record). The dashboard walkthrough wants a clean starting
 * state instead. Keeping the two separate — repros for evidence, reset for a
 * clean demo — is clearer than overloading either.
 *
 * Note: broken-mode decisions never write a component audit row (the app only
 * calls the component's authorize() in intersection mode), so this only needs to
 * clear the host tables — the audit trail already reflects real decisions only.
 */
export const resetDemoOrg = internalMutation({
  args: {orgCode: v.string()},
  returns: v.object({
    contracts: v.number(),
    clauses: v.number(),
    reviewRuns: v.number()
  }),
  handler: async (ctx, args) => {
    const contracts = await ctx.db
      .query('contracts')
      .withIndex('by_orgCode', (q) => q.eq('orgCode', args.orgCode))
      .collect();

    let clauseCount = 0;
    for (const contract of contracts) {
      const clauses = await ctx.db
        .query('clauses')
        .withIndex('by_contract', (q) => q.eq('contractId', contract._id))
        .collect();
      for (const clause of clauses) {
        await ctx.db.delete(clause._id);
        clauseCount++;
      }
      await ctx.db.delete(contract._id);
    }

    const runs = await ctx.db
      .query('reviewRuns')
      .withIndex('by_orgCode', (q) => q.eq('orgCode', args.orgCode))
      .collect();
    for (const run of runs) {
      await ctx.db.delete(run._id);
    }

    return {
      contracts: contracts.length,
      clauses: clauseCount,
      reviewRuns: runs.length
    };
  }
});
