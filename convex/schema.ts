import {defineSchema, defineTable} from 'convex/server';
import {v} from 'convex/values';

/**
 * Host-app domain model. The agent-auth component manages its own tables
 * internally (agents, delegations, audit, …) — these are the app's tables.
 *
 * Tenancy: every row that belongs to an organization carries `orgCode`, the
 * Kinde org identifier, so queries can be scoped per tenant and never leak
 * across orgs.
 */
export default defineSchema({
  // Mirror of a Kinde organization.
  organizations: defineTable({
    orgCode: v.string(), // the Kinde org identifier
    name: v.string()
  }).index('by_orgCode', ['orgCode']),

  // A contract uploaded into an org, made up of clauses.
  contracts: defineTable({
    title: v.string(),
    orgCode: v.string(),
    // Nullable until the upload lands (later phase) — modelled as optional.
    storageId: v.optional(v.id('_storage')),
    uploadedBy: v.string(), // the Kinde user id
    status: v.union(
      v.literal('uploaded'),
      v.literal('reviewing'),
      v.literal('reviewed')
    ),
    createdAt: v.number()
  })
    .index('by_orgCode', ['orgCode'])
    .index('by_orgCode_status', ['orgCode', 'status']),

  // A single clause within a contract, with its risk assessment and decision.
  clauses: defineTable({
    contractId: v.id('contracts'),
    orgCode: v.string(), // denormalized for tenant-scoped queries
    index: v.number(), // clause order within the contract
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
    ),
    decidedBy: v.optional(v.string()), // identity credited with the decision
    decisionCorrelationId: v.optional(v.string()), // ties to the component's audit row
    decidedAt: v.optional(v.number())
  })
    .index('by_contract', ['contractId'])
    .index('by_orgCode_status', ['orgCode', 'status']),

  // An agent review run over a contract, authorized against the agent-auth
  // component's run instance.
  reviewRuns: defineTable({
    contractId: v.id('contracts'),
    orgCode: v.string(),
    instanceId: v.string(), // the agent-auth run instance this review authorizes against
    actingSubject: v.string(), // the human on whose behalf the crew acts
    mode: v.union(v.literal('broken'), v.literal('intersection')),
    status: v.union(
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed')
    ),
    startedAt: v.number(),
    finishedAt: v.optional(v.number())
  })
    .index('by_contract', ['contractId'])
    .index('by_orgCode', ['orgCode'])
});
