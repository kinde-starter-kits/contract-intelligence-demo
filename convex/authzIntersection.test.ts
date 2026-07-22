/// <reference types="vite/client" />
import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi
} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {SignJWT, exportJWK, generateKeyPair} from 'jose';
import {api, internal} from './_generated/api';
import type {Id} from './_generated/dataModel';
import {initConvexTest} from './setup.test';
import {runDeterministicReview, type CrewPost} from '../lib/agent-run';

/**
 * End-to-end authorization tests through the crew's HTTP surface, in BOTH modes.
 * A minted RS256 token is verified against a stubbed Kinde JWKS (the component's
 * real verifyCaller/authorize run), so this exercises the full path:
 * httpAction → verifyCaller → authorizeAgentAction → component authorize().
 */

const DOMAIN = 'acme.kinde.com';
const ISSUER = `https://${DOMAIN}`;
const JWKS_URL = `https://${DOMAIN}/.well-known/jwks`;
const CONFIG_URL = `https://${DOMAIN}/.well-known/openid-configuration`;

const ORG = 'org_acme';
const CLIENT = 'm2m_crew';
const CREW_SCOPES = ['contracts:read', 'clauses:flag', 'clauses:approve'];
const INTERN = 'kp_demo_intern';
const ADMIN = 'kp_demo_admin';

const acmeText = readFileSync(
  join(__dirname, '..', 'fixtures', 'acme-msa.txt'),
  'utf-8'
);

type JwkRecord = Record<string, string | string[]>;
let mainKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let mainJwk: JwkRecord;

beforeAll(async () => {
  const main = await generateKeyPair('RS256', {extractable: true});
  mainKey = main.privateKey;
  const jwk = await exportJWK(main.publicKey);
  mainJwk = {kid: 'key-main', alg: 'RS256', use: 'sig'};
  for (const [k, val] of Object.entries(jwk)) {
    if (typeof val === 'string') mainJwk[k] = val;
  }
});

// Each test user's permissions in the org, as the Kinde Management API would
// return them. This is what review-start resolves to build the delegation.
const USER_PERMISSIONS: Record<string, string[]> = {
  [INTERN]: ['contracts:read'],
  [ADMIN]: ['contracts:read', 'clauses:flag', 'clauses:approve']
};

function stubKinde() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === CONFIG_URL) {
        return new Response(JSON.stringify({jwks_uri: JWKS_URL}), {
          status: 200,
          headers: {'Content-Type': 'application/json'}
        });
      }
      if (url === JWKS_URL) {
        return new Response(JSON.stringify({keys: [mainJwk]}), {
          status: 200,
          headers: {'Content-Type': 'application/json'}
        });
      }
      // Kinde Management API: token (client_credentials) + user org permissions.
      if (url === `${ISSUER}/oauth2/token` && init?.method === 'POST') {
        return new Response(
          JSON.stringify({access_token: 'mgmt-token', expires_in: 3600}),
          {status: 200, headers: {'Content-Type': 'application/json'}}
        );
      }
      const permMatch = url.match(/\/users\/([^/]+)\/permissions$/);
      if (permMatch) {
        const userId = permMatch[1];
        const permissions = (USER_PERMISSIONS[userId] ?? []).map((key) => ({
          key
        }));
        return new Response(JSON.stringify({permissions}), {
          status: 200,
          headers: {'Content-Type': 'application/json'}
        });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? ''}`);
    })
  );
}

async function mintCrewToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    gty: 'client_credentials',
    azp: CLIENT,
    org_code: ORG,
    scp: CREW_SCOPES
  })
    .setProtectedHeader({alg: 'RS256', kid: 'key-main'})
    .setIssuedAt(now - 60)
    .setIssuer(ISSUER)
    .setSubject(CLIENT)
    .setExpirationTime(now + 3600)
    .sign(mainKey);
}

beforeEach(() => {
  vi.stubEnv('KINDE_DOMAIN', DOMAIN);
  vi.stubEnv('DELEGATION_SIGNING_SECRET', 'test-delegation-secret');
  vi.stubEnv('MODE', 'test');
  // Management-API credentials so review-start resolves the human's ceiling.
  vi.stubEnv('KINDE_MGMT_CLIENT_ID', 'mgmt-client');
  vi.stubEnv('KINDE_MGMT_CLIENT_SECRET', 'mgmt-secret');
  stubKinde();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(t: ReturnType<typeof initConvexTest>) {
  await t.mutation(internal.agents.provisionAgent, {
    kindeClientId: CLIENT,
    name: 'Contract Review Crew',
    slug: 'contract-review-crew',
    orgCode: ORG,
    scopes: CREW_SCOPES,
    // allowedTools in the permission namespace so `authorize()` gates on scopes.
    allowedTools: CREW_SCOPES
  });
  const {contractId} = await t.mutation(internal.ingest.ingestContractText, {
    orgCode: ORG,
    uploadedBy: ADMIN,
    title: 'Acme MSA',
    text: acmeText
  });
  const clauses = await t.query(internal.agentReview.listClausesForAgent, {
    orgCode: ORG,
    contractId
  });
  const token = await mintCrewToken();
  return {contractId, clauses, token};
}

function headers(token: string, actingSubject: string) {
  return {
    authorization: `Bearer ${token}`,
    'x-acting-subject': actingSubject,
    'content-type': 'application/json'
  };
}

async function startReview(
  t: ReturnType<typeof initConvexTest>,
  token: string,
  actingSubject: string,
  contractId: string
) {
  const res = await t.fetch('/agent/review/start', {
    method: 'POST',
    headers: headers(token, actingSubject),
    body: JSON.stringify({contractId})
  });
  return {status: res.status, body: await res.json()};
}

async function approve(
  t: ReturnType<typeof initConvexTest>,
  token: string,
  actingSubject: string,
  reviewRunId: string,
  clauseId: string
) {
  const res = await t.fetch('/agent/approve', {
    method: 'POST',
    headers: headers(token, actingSubject),
    body: JSON.stringify({reviewRunId, clauseId})
  });
  return {status: res.status, body: await res.json()};
}

describe('AUTHZ_MODE=broken — the confused deputy (real HTTP path)', () => {
  test('a read-only Intern approves a clause (agent identity only)', async () => {
    vi.stubEnv('AUTHZ_MODE', 'broken');
    const t = initConvexTest();
    const {contractId, clauses, token} = await setup(t);

    const start = await startReview(t, token, INTERN, contractId);
    expect(start.body.mode).toBe('broken');

    const res = await approve(
      t,
      token,
      INTERN,
      start.body.reviewRunId,
      clauses[4].clauseId
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.authz.humanChecked).toBe(false);
  });
});

describe('AUTHZ_MODE=intersection — the fix (human ∩ agent)', () => {
  test('the Intern approve is DENIED (insufficient_scope) and the clause is NOT approved', async () => {
    vi.stubEnv('AUTHZ_MODE', 'intersection');
    const t = initConvexTest();
    const {contractId, clauses, token} = await setup(t);

    // review-start resolves the Intern's ceiling from (stubbed) Kinde
    // (contracts:read only) and issues the delegation — no manual seeding.
    const start = await startReview(t, token, INTERN, contractId);
    expect(start.body.mode).toBe('intersection');

    const res = await approve(
      t,
      token,
      INTERN,
      start.body.reviewRunId,
      clauses[4].clauseId
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('authorization_denied');
    expect(res.body.humanChecked).toBe(true);
    expect(res.body.reason).toBe('insufficient_scope');
    expect(res.body.correlationId).toBeTruthy();
    expect(res.body.requiredScopes).toContain('clauses:approve');

    // The clause was NOT flipped.
    const row = await t.run(async (ctx) => ctx.db.get(clauses[4].clauseId));
    expect(row?.status).not.toBe('approved');
  });

  test('the Admin approve is ALLOWED and the clause is approved', async () => {
    vi.stubEnv('AUTHZ_MODE', 'intersection');
    const t = initConvexTest();
    const {contractId, clauses, token} = await setup(t);

    // review-start resolves the Admin's ceiling from (stubbed) Kinde
    // (read + flag + approve) and issues the delegation.
    const start = await startReview(t, token, ADMIN, contractId);

    const res = await approve(
      t,
      token,
      ADMIN,
      start.body.reviewRunId,
      clauses[4].clauseId
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.authz.mode).toBe('intersection');
    expect(res.body.authz.humanChecked).toBe(true);

    const row = await t.run(async (ctx) => ctx.db.get(clauses[4].clauseId));
    expect(row?.status).toBe('approved');
    expect(row?.decidedBy).toBe(ADMIN);
  });
});

describe('live run events — persisted, ordered, subscribable', () => {
  test('an allowed run persists run_started → signoff_allowed in order', async () => {
    vi.stubEnv('AUTHZ_MODE', 'intersection');
    const t = initConvexTest();
    const {contractId, clauses, token} = await setup(t);

    const start = await startReview(t, token, ADMIN, contractId);
    const res = await approve(
      t,
      token,
      ADMIN,
      start.body.reviewRunId,
      clauses[4].clauseId
    );
    expect(res.status).toBe(200);

    const events = await t.query(api.runEvents.listRunEvents, {
      reviewRunId: start.body.reviewRunId
    });
    // Sequence numbers are dense and monotonically increasing (order preserved).
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('run_started');
    expect(types).toContain('signoff_allowed');
    expect(types.indexOf('run_started')).toBeLessThan(
      types.indexOf('signoff_allowed')
    );
    const allowed = events.find((e) => e.type === 'signoff_allowed');
    expect(allowed?.detail?.clauseId).toBe(clauses[4].clauseId);
  });

  test('a denied run persists a signoff_denied event carrying the reason', async () => {
    vi.stubEnv('AUTHZ_MODE', 'intersection');
    const t = initConvexTest();
    const {contractId, clauses, token} = await setup(t);

    const start = await startReview(t, token, INTERN, contractId);
    const res = await approve(
      t,
      token,
      INTERN,
      start.body.reviewRunId,
      clauses[4].clauseId
    );
    expect(res.status).toBe(403);

    const events = await t.query(api.runEvents.listRunEvents, {
      reviewRunId: start.body.reviewRunId
    });
    const denied = events.find((e) => e.type === 'signoff_denied');
    expect(denied).toBeTruthy();
    expect(denied?.detail?.status).toBe('denied');
    expect(denied?.detail?.reason).toBe('insufficient_scope');
    expect(denied?.detail?.correlationId).toBeTruthy();
    // The denied clause was NOT recorded as allowed.
    expect(events.some((e) => e.type === 'signoff_allowed')).toBe(false);
  });
});

/**
 * End-to-end: the SAME server-side driver the /api/run route uses
 * (runDeterministicReview) drives a full multi-clause run over the real crew
 * HTTP endpoints, and the whole event stream is persisted in order — in BOTH
 * modes. This is what the "Run review" button produces.
 */
describe('full deterministic run streams events end-to-end', () => {
  function driverPost(
    t: ReturnType<typeof initConvexTest>,
    token: string,
    subject: string
  ): CrewPost {
    return async (path, payload) => {
      const res = await t.fetch(path, {
        method: 'POST',
        headers: headers(token, subject),
        body: JSON.stringify(payload)
      });
      const body = await res.json().catch(() => ({}));
      return {status: res.status, body};
    };
  }

  async function streamOf(
    t: ReturnType<typeof initConvexTest>,
    reviewRunId: string
  ) {
    return t.query(api.runEvents.listRunEvents, {
      reviewRunId: reviewRunId as Id<'reviewRuns'>
    });
  }

  function assertCommonShape(events: Awaited<ReturnType<typeof streamOf>>) {
    // Dense, monotonic seq → ordered and complete.
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('run_started');
    expect(types[types.length - 1]).toBe('run_complete');
    expect(types).toContain('extractor_started');
    expect(types).toContain('clause_extracted');
    expect(types).toContain('clause_assessed');
  }

  test('broken mode: an Intern run goes through (confused deputy) and streams signoff_allowed', async () => {
    vi.stubEnv('AUTHZ_MODE', 'broken');
    const t = initConvexTest();
    const {contractId, token} = await setup(t);

    const summary = await runDeterministicReview(
      driverPost(t, token, INTERN),
      contractId
    );
    expect(summary.mode).toBe('broken');
    expect(summary.totalClauses).toBeGreaterThan(0);
    expect(summary.approved).toBeGreaterThan(0);
    expect(summary.denied).toBe(0);

    const events = await streamOf(t, summary.reviewRunId);
    assertCommonShape(events);
    const types = events.map((e) => e.type);
    expect(types).toContain('signoff_allowed');
    expect(types).not.toContain('signoff_denied');

    // The money moment: a HIGH-risk clause is among those signed off on the
    // agent's authority — the exact action the Intern could never take. This is
    // the data the timeline's confused-deputy callout keys on.
    const highClauses = new Set(
      events
        .filter(
          (e) => e.type === 'clause_assessed' && e.detail?.riskLevel === 'high'
        )
        .map((e) => e.detail?.clauseId)
    );
    expect(highClauses.size).toBeGreaterThan(0);
    const approvedHigh = events.some(
      (e) => e.type === 'signoff_allowed' && highClauses.has(e.detail?.clauseId)
    );
    expect(approvedHigh).toBe(true);
  });

  test('intersection mode: an Intern run is denied and streams signoff_denied', async () => {
    vi.stubEnv('AUTHZ_MODE', 'intersection');
    const t = initConvexTest();
    const {contractId, token} = await setup(t);

    const summary = await runDeterministicReview(
      driverPost(t, token, INTERN),
      contractId
    );
    expect(summary.mode).toBe('intersection');
    expect(summary.approved).toBe(0);
    expect(summary.denied).toBeGreaterThan(0);

    const events = await streamOf(t, summary.reviewRunId);
    assertCommonShape(events);
    const types = events.map((e) => e.type);
    expect(types).toContain('signoff_denied');
    expect(types).not.toContain('signoff_allowed');
  });

  test('intersection mode: an Admin run is allowed and streams signoff_allowed', async () => {
    vi.stubEnv('AUTHZ_MODE', 'intersection');
    const t = initConvexTest();
    const {contractId, token} = await setup(t);

    const summary = await runDeterministicReview(
      driverPost(t, token, ADMIN),
      contractId
    );
    expect(summary.mode).toBe('intersection');
    expect(summary.approved).toBeGreaterThan(0);
    expect(summary.denied).toBe(0);

    const events = await streamOf(t, summary.reviewRunId);
    assertCommonShape(events);
    const types = events.map((e) => e.type);
    expect(types).toContain('signoff_allowed');
    expect(types).not.toContain('signoff_denied');
  });
});
