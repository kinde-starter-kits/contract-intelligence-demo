/**
 * Reset the demo org to a clean, honest starting state for an intersection-mode
 * dashboard walkthrough:
 *   - delete the org's contracts / clauses / review runs (the leftover
 *     broken-mode intern approvals),
 *   - clear the org's Weaviate clause tenant,
 *   - ingest + embed ONE fresh contract,
 *   - flag its high-risk "Limitation of Liability" clause as the ADMIN (who may
 *     flag), so the walkthrough shows a real high-risk clause up for sign-off —
 *     with NO clause approved by the Intern.
 *
 * After this, signing in as the Intern shows no intern approvals; forcing the
 * approve gives the 403.
 *
 *   npx tsx scripts/reset-demo.ts
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  withWeaviate,
  clearOrgClauses,
  upsertClauses,
  type ClauseRecord
} from '../lib/weaviate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORG = 'org_d8d0c41009eb1';
const ADMIN = 'kp_a7b6a3daad074ec4b1743754bec659aa';

function loadEnvFile(rel: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text = '';
  try {
    text = readFileSync(join(root, rel), 'utf-8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

const localEnv = loadEnvFile('.env.local');
const agentEnv = loadEnvFile('agents/.env');
// Point the in-process Weaviate client at whatever .env.local uses (Cloud/local).
if (localEnv.WEAVIATE_URL) process.env.WEAVIATE_URL = localEnv.WEAVIATE_URL;
if (localEnv.WEAVIATE_API_KEY)
  process.env.WEAVIATE_API_KEY = localEnv.WEAVIATE_API_KEY;

const CONVEX_SITE_URL = (agentEnv.CONVEX_SITE_URL ?? '').replace(/\/$/, '');
const KINDE_DOMAIN = (agentEnv.KINDE_DOMAIN ?? '').replace(/^https?:\/\//, '');
const AUDIENCE = agentEnv.KINDE_AUDIENCE ?? 'contract-intelligence-api';

function run(cmd: string, args: string[]): string {
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      return execFileSync(cmd, args, {encoding: 'utf-8', cwd: root});
    } catch (err) {
      lastErr = err;
      execFileSync('sleep', [String(1.5 * (i + 1))]);
    }
  }
  throw lastErr;
}
function extractJson<T>(s: string, open = '{', close = '}'): T {
  const a = s.indexOf(open);
  const b = s.lastIndexOf(close);
  if (a === -1 || b === -1) throw new Error(`No JSON in: ${s}`);
  return JSON.parse(s.slice(a, b + 1)) as T;
}
async function mintToken(): Promise<string> {
  const resp = await fetch(`https://${KINDE_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: agentEnv.CREW_M2M_CLIENT_ID,
      client_secret: agentEnv.CREW_M2M_CLIENT_SECRET,
      audience: AUDIENCE
    })
  });
  return (await resp.json()).access_token as string;
}
async function agent(
  path: string,
  body: unknown,
  token: string,
  subject: string
) {
  const resp = await fetch(`${CONVEX_SITE_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-acting-subject': subject,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return {
    status: resp.status,
    body: (await resp.json()) as Record<string, unknown>
  };
}

async function main() {
  console.log(
    '== Reset demo org to a clean intersection walkthrough state ==\n'
  );

  run('npx', ['convex', 'env', 'set', 'AUTHZ_MODE', 'intersection']);

  // 1. Delete the org's contracts / clauses / review runs.
  const del = extractJson<{
    contracts: number;
    clauses: number;
    reviewRuns: number;
  }>(
    run('npx', [
      'convex',
      'run',
      'demoReset:resetDemoOrg',
      JSON.stringify({orgCode: ORG})
    ])
  );
  console.log(
    `Deleted: ${del.contracts} contracts, ${del.clauses} clauses, ${del.reviewRuns} review runs.`
  );

  // 2. Clear the org's Weaviate clause tenant.
  await withWeaviate((c) => clearOrgClauses(c, ORG));
  console.log('Cleared the org’s Weaviate clause tenant.');

  // 3. Ingest a fresh contract.
  const text = readFileSync(join(root, 'fixtures', 'acme-msa.txt'), 'utf-8');
  const {contractId} = extractJson<{contractId: string}>(
    run('npx', [
      'convex',
      'run',
      'ingest:ingestContractText',
      JSON.stringify({
        orgCode: ORG,
        uploadedBy: ADMIN,
        title: 'Acme Master Services Agreement',
        text
      })
    ])
  );
  console.log(`Ingested fresh contract ${contractId}.`);

  // 4. Embed its clauses into Weaviate.
  const records = extractJson<ClauseRecord[]>(
    run('npx', [
      'convex',
      'run',
      'ingest:getClauseRecords',
      JSON.stringify({contractId})
    ]),
    '[',
    ']'
  );
  await withWeaviate((c) => upsertClauses(c, ORG, records));
  console.log(`Embedded ${records.length} clauses.`);

  // 5. Flag the high-risk clause as the ADMIN (allowed) — no intern approvals.
  const token = await mintToken();
  const adminRun = await agent(
    '/agent/review/start',
    {contractId},
    token,
    ADMIN
  );
  const clausesResp = await agent('/agent/clauses', {contractId}, token, ADMIN);
  const clauses = clausesResp.body.clauses as Array<{
    clauseId: string;
    text: string;
  }>;
  const risky =
    clauses.find((c) => c.text.includes('Limitation of Liability')) ??
    clauses[0];
  const flagged = await agent(
    '/agent/flag',
    {
      reviewRunId: adminRun.body.reviewRunId,
      clauseId: risky.clauseId,
      riskLevel: 'high',
      rationale:
        'Caps aggregate liability — high risk; sign-off needs approve authority.'
    },
    token,
    ADMIN
  );
  console.log(
    `Flagged the "Limitation of Liability" clause HIGH as the Admin (HTTP ${flagged.status}).`
  );

  // 6. Verify: no clause is approved-by-intern.
  const all = extractJson<
    Array<{status: string; decidedBy?: string; index: number}>
  >(
    run('npx', [
      'convex',
      'run',
      'contracts:listClausesByContract',
      JSON.stringify({contractId})
    ]),
    '[',
    ']'
  );
  const internApprovals = all.filter(
    (c) =>
      c.status === 'approved' &&
      c.decidedBy &&
      c.decidedBy.startsWith('kp_0d4f')
  );
  const approvedCount = all.filter((c) => c.status === 'approved').length;

  console.log('\n================= CLEAN STATE =================');
  console.log(`Contract: ${contractId}  (${all.length} clauses)`);
  console.log(
    `Approved clauses: ${approvedCount}   approved-by-Intern: ${internApprovals.length}`
  );
  console.log('==============================================\n');

  if (internApprovals.length === 0) {
    console.log(
      '✅ Clean: no clause is approved by the Intern. Sign in as the Intern and\n' +
        '   force Approve → 403 insufficient_scope.'
    );
    process.exit(0);
  }
  console.error('❌ Still found intern approvals after reset.');
  process.exit(1);
}

main().catch((err) => {
  console.error('reset error:', err instanceof Error ? err.message : err);
  process.exit(2);
});
