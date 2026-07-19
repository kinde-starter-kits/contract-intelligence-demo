import {query} from './_generated/server';
import {components} from './_generated/api';
import {paginationOptsValidator} from 'convex/server';
import {v} from 'convex/values';
import {resolveAuthzMode} from './authz';

/**
 * Read-only queries backing the dashboard UI. They are org-scoped by the
 * `orgCode` the server page passes from the verified Kinde session; the UI
 * renders reactively from them. (Writes go through the crew endpoints with real
 * auth — the UI never mutates directly.)
 */

/**
 * The SERVER-decided authorization mode. The client reads it here and cannot set
 * it — the value is whatever `AUTHZ_MODE` is on the deployment.
 */
export const getAuthzMode = query({
  args: {},
  returns: v.object({
    mode: v.union(v.literal('broken'), v.literal('intersection'))
  }),
  handler: async () => ({mode: resolveAuthzMode()})
});

/** Review runs for an org, newest first. */
export const listReviewRuns = query({
  args: {orgCode: v.string()},
  returns: v.array(
    v.object({
      _id: v.id('reviewRuns'),
      contractId: v.id('contracts'),
      instanceId: v.string(),
      actingSubject: v.string(),
      mode: v.union(v.literal('broken'), v.literal('intersection')),
      status: v.union(
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed')
      ),
      startedAt: v.number(),
      finishedAt: v.optional(v.number())
    })
  ),
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query('reviewRuns')
      .withIndex('by_orgCode', (q) => q.eq('orgCode', args.orgCode))
      .collect();
    return runs
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((r) => ({
        _id: r._id,
        contractId: r.contractId,
        instanceId: r.instanceId,
        actingSubject: r.actingSubject,
        mode: r.mode,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt
      }));
  }
});

/**
 * A page of the component's audit rows for an org — for the audit panel. Uses
 * Convex pagination (usePaginatedQuery on the client). Each row ties a decision
 * to its action, reason, the ceiling used (scopesUsed) and a correlationId.
 */
export const auditPage = query({
  args: {
    orgCode: v.string(),
    paginationOpts: paginationOptsValidator
  },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.string(),
        eventType: v.string(),
        decision: v.union(v.literal('allow'), v.literal('deny'), v.null()),
        action: v.union(v.string(), v.null()),
        reason: v.union(v.string(), v.null()),
        callerSubject: v.union(v.string(), v.null()),
        scopesUsed: v.union(v.array(v.string()), v.null()),
        correlationId: v.union(v.string(), v.null()),
        at: v.number()
      })
    ),
    isDone: v.boolean(),
    continueCursor: v.string()
  }),
  handler: async (ctx, args) => {
    const res = await ctx.runQuery(components.agentAuth.audit.query, {
      orgCode: args.orgCode,
      paginationOpts: args.paginationOpts
    });
    const asStr = (x: unknown): string | null =>
      typeof x === 'string' ? x : null;
    return {
      page: res.page.map((r) => ({
        _id: r._id,
        eventType: r.eventType,
        decision: r.decision,
        action: asStr(r.detail?.action),
        reason: asStr(r.detail?.reason),
        callerSubject: asStr(r.detail?.callerSubject),
        scopesUsed: r.scopesUsed,
        correlationId: r.correlationId,
        at: r.at
      })),
      isDone: res.isDone,
      continueCursor: res.continueCursor
    };
  }
});
