import {mutation} from './_generated/server';
import {v} from 'convex/values';
import {requireHumanOrg} from './sessionAuth';

/**
 * Step 1 of upload: hand the client a short-lived URL to POST the file to
 * Convex file storage. Requires a signed-in human.
 */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireHumanOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  }
});

/**
 * Step 2 of upload: record the uploaded file (its `storageId`) as a contract
 * row. `orgCode` and `uploadedBy` come from the verified session — never from
 * client input — so a contract is always bound to the caller's org and user.
 * Clause extraction + embedding runs afterwards via `ingestUploadedContract`.
 */
export const createContractFromUpload = mutation({
  args: {
    storageId: v.id('_storage'),
    title: v.string()
  },
  returns: v.id('contracts'),
  handler: async (ctx, args) => {
    const {subject, orgCode} = await requireHumanOrg(ctx);
    return await ctx.db.insert('contracts', {
      title: args.title,
      orgCode,
      storageId: args.storageId,
      uploadedBy: subject,
      status: 'uploaded',
      createdAt: Date.now()
    });
  }
});
