import {internalMutation, internalQuery} from './_generated/server';
import {v} from 'convex/values';
import {chunkContract} from './chunker';

/**
 * Deterministic ingestion of contract text into clause rows.
 *
 * The chunker is a pure function, so running it inside a mutation is fine: the
 * same text always produces the same ordered clauses. Clauses start
 * `unassessed` / `pending`; the crew and humans move them along in later phases.
 * Embedding into Weaviate is a separate step (see `ingestUploadedContract`).
 */

/** Insert ordered clause rows for an existing contract from its raw text. */
export const writeClausesFromText = internalMutation({
  args: {
    contractId: v.id('contracts'),
    orgCode: v.string(),
    text: v.string()
  },
  returns: v.object({clauseCount: v.number()}),
  handler: async (ctx, args) => {
    const clauses = chunkContract(args.text);
    for (const clause of clauses) {
      await ctx.db.insert('clauses', {
        contractId: args.contractId,
        orgCode: args.orgCode,
        index: clause.index,
        text: clause.text,
        riskLevel: 'unassessed',
        status: 'pending'
      });
    }
    return {clauseCount: clauses.length};
  }
});

/**
 * Create a contract row AND its clause rows from raw text in one call. The
 * tested core of ingestion (no storage, no network) — deterministic end to end.
 */
export const ingestContractText = internalMutation({
  args: {
    orgCode: v.string(),
    uploadedBy: v.string(),
    title: v.string(),
    text: v.string()
  },
  returns: v.object({
    contractId: v.id('contracts'),
    clauseCount: v.number()
  }),
  handler: async (ctx, args) => {
    const contractId = await ctx.db.insert('contracts', {
      title: args.title,
      orgCode: args.orgCode,
      uploadedBy: args.uploadedBy,
      status: 'uploaded',
      createdAt: Date.now()
    });

    const clauses = chunkContract(args.text);
    for (const clause of clauses) {
      await ctx.db.insert('clauses', {
        contractId,
        orgCode: args.orgCode,
        index: clause.index,
        text: clause.text,
        riskLevel: 'unassessed',
        status: 'pending'
      });
    }
    return {contractId, clauseCount: clauses.length};
  }
});

/** Fetch a contract row for the ingestion action. */
export const getContractInternal = internalQuery({
  args: {contractId: v.id('contracts')},
  returns: v.union(
    v.object({
      _id: v.id('contracts'),
      orgCode: v.string(),
      storageId: v.optional(v.id('_storage')),
      title: v.string()
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.contractId);
    if (!c) return null;
    return {
      _id: c._id,
      orgCode: c.orgCode,
      storageId: c.storageId,
      title: c.title
    };
  }
});

/** Fetch a contract's clauses as embedding records, in order. */
export const getClauseRecords = internalQuery({
  args: {contractId: v.id('contracts')},
  returns: v.array(
    v.object({
      clauseId: v.string(),
      contractId: v.string(),
      orgCode: v.string(),
      clauseIndex: v.number(),
      text: v.string()
    })
  ),
  handler: async (ctx, args) => {
    const clauses = await ctx.db
      .query('clauses')
      .withIndex('by_contract', (q) => q.eq('contractId', args.contractId))
      .collect();
    return clauses
      .sort((a, b) => a.index - b.index)
      .map((c) => ({
        clauseId: c._id,
        contractId: c.contractId,
        orgCode: c.orgCode,
        clauseIndex: c.index,
        text: c.text
      }));
  }
});
