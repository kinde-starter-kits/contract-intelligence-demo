import {internalAction} from './_generated/server';
import {internal} from './_generated/api';
import {v} from 'convex/values';

/**
 * Ingestion of an uploaded file's structured content: read the stored text and
 * write ordered clause rows.
 *
 * Kept in its own module (separate from the queries/mutations it calls) so the
 * action referencing `internal.ingest.*` doesn't form a same-module type cycle.
 *
 * Text extraction assumes plain-text (.txt) contracts for this demo (see
 * BUILD_LOG — richer formats are out of scope).
 *
 * NOTE — embedding is NOT done here. Clause vectors are computed CLIENT-SIDE
 * (all-MiniLM-L6-v2 via Transformers.js) in the app/agent layer (`lib/weaviate.ts`),
 * which the ONNX runtime requires — Convex functions can't run it. The app pulls
 * a contract's clauses (see `internal.ingest.getClauseRecords`), embeds them, and
 * stores the vectors in Weaviate. See docs/weaviate-setup.md.
 */
export const ingestUploadedContract = internalAction({
  args: {contractId: v.id('contracts')},
  returns: v.object({clauseCount: v.number()}),
  handler: async (ctx, args): Promise<{clauseCount: number}> => {
    const contract = await ctx.runQuery(internal.ingest.getContractInternal, {
      contractId: args.contractId
    });
    if (!contract) throw new Error('Contract not found.');
    if (!contract.storageId) throw new Error('Contract has no uploaded file.');

    const blob = await ctx.storage.get(contract.storageId);
    if (!blob) throw new Error('Uploaded file is missing from storage.');
    const text = await blob.text();

    const {clauseCount} = await ctx.runMutation(
      internal.ingest.writeClausesFromText,
      {contractId: args.contractId, orgCode: contract.orgCode, text}
    );
    return {clauseCount};
  }
});
