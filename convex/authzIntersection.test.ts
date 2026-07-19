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
import {internal} from './_generated/api';
import {initConvexTest} from './setup.test';

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

function stubKinde() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
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
      throw new Error(`Unexpected fetch: ${url}`);
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

    const start = await startReview(t, token, INTERN, contractId);
    expect(start.body.mode).toBe('intersection');

    // The Intern's ceiling: read only.
    const agent = await t.query(internal.agents.getAgentByClientId, {
      kindeClientId: CLIENT,
      orgCode: ORG
    });
    await t.mutation(internal.agentDelegation.issueHumanDelegation, {
      agentId: agent!.agentId,
      actingSubject: INTERN,
      permissions: ['contracts:read']
    });

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

    const start = await startReview(t, token, ADMIN, contractId);

    const agent = await t.query(internal.agents.getAgentByClientId, {
      kindeClientId: CLIENT,
      orgCode: ORG
    });
    // The Admin's ceiling: read + flag + approve.
    await t.mutation(internal.agentDelegation.issueHumanDelegation, {
      agentId: agent!.agentId,
      actingSubject: ADMIN,
      permissions: CREW_SCOPES
    });

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
