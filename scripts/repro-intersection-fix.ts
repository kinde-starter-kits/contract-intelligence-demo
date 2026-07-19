/**
 * The FIX (AUTHZ_MODE=intersection): agent actions are authorized as the
 * intersection of the acting human's permissions and the agent's, via the
 * component's authorize(). The same Sign-off approval that landed in broken mode
 * is now DENIED for the read-only Intern (machine-readable reason + correlationId
 * + audit row), while the Admin — who holds clauses:approve — is ALLOWED.
 *
 * Run the two together for the before/after:
 *   npx tsx scripts/repro-confused-deputy.ts     # broken: Intern approves
 *   npx tsx scripts/repro-intersection-fix.ts    # intersection: Intern denied, Admin allowed
 *
 * Exits non-zero unless the Intern is denied AND the Admin is allowed.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORG = 'org_d8d0c41009eb1';
const INTERN = 'kp_0d4f620753b84b06b32a5738c1fc6f1c'; // read-only: contracts:read
const ADMIN = 'kp_a7b6a3daad074ec4b1743754bec659aa'; // contracts:read, clauses:flag, clauses:approve
const ADMIN_PERMS = ['contracts:read', 'clauses:flag', 'clauses:approve'];

function loadAgentEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(root, 'agents', '.env'), 'utf-8').split(
    '\n'
  )) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
  }
  return env;
}
const env = loadAgentEnv();
const CONVEX_SITE_URL = (env.CONVEX_SITE_URL ?? '').replace(/\/$/, '');
const KINDE_DOMAIN = (env.KINDE_DOMAIN ?? '').replace(/^https?:\/\//, '');
const AUDIENCE = env.KINDE_AUDIENCE ?? 'contract-intelligence-api';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function extractJson<T>(stdout: string, open = '{', close = '}'): T {
  const s = stdout.indexOf(open);
  const e = stdout.lastIndexOf(close);
  if (s === -1 || e === -1) throw new Error(`No JSON in: ${stdout}`);
  return JSON.parse(stdout.slice(s, e + 1)) as T;
}

async function fetchRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

async function mintToken(): Promise<string> {
  const resp = await fetchRetry(`https://${KINDE_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.CREW_M2M_CLIENT_ID,
      client_secret: env.CREW_M2M_CLIENT_SECRET,
      audience: AUDIENCE
    })
  });
  return (await resp.json()).access_token as string;
}

async function agent(
  path: string,
  body: unknown,
  token: string,
  actingSubject: string
): Promise<{status: number; body: Record<string, unknown>}> {
  const resp = await fetchRetry(`${CONVEX_SITE_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-acting-subject': actingSubject,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return {status: resp.status, body: await resp.json()};
}

async function main() {
  console.log('== Intersection fix (human ∩ agent) ==\n');

  // 1. Server-decided intersection mode; sync the agent's policy.
  run('npx', ['convex', 'env', 'set', 'AUTHZ_MODE', 'intersection']);
  run('npx', [
    'convex',
    'run',
    'agents:provisionAgent',
    JSON.stringify({
      kindeClientId: env.CREW_M2M_CLIENT_ID,
      name: 'Contract Review Crew',
      slug: 'contract-review-crew',
      orgCode: ORG,
      scopes: ADMIN_PERMS,
      allowedTools: ADMIN_PERMS
    })
  ]);
  console.log('AUTHZ_MODE=intersection set; agent policy synced.\n');

  // 2. Ingest + embed a fixture.
  const text = readFileSync(join(root, 'fixtures', 'acme-msa.txt'), 'utf-8');
  const {contractId} = extractJson<{contractId: string}>(
    run('npx', [
      'convex',
      'run',
      'ingest:ingestContractText',
      JSON.stringify({
        orgCode: ORG,
        uploadedBy: ADMIN,
        title: 'Acme MSA (intersection)',
        text
      })
    ])
  );
  run('npx', ['tsx', 'scripts/embed-contract.ts', contractId, ORG]);
  console.log(`Ingested + embedded contract ${contractId}.`);

  // 3. No seeded delegation: review-start (intersection) resolves each human's
  //    permission ceiling FROM KINDE (Management API) and issues the delegation.
  //    Requires KINDE_MGMT_CLIENT_ID/SECRET on the deployment.
  console.log(
    'Human ceilings will be resolved from Kinde at review-start (no seeding).\n'
  );

  const token = await mintToken();

  // 4. Flag the risky clause (as the Admin, who may flag) so it's a real
  //    high-risk clause up for sign-off.
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
  await agent(
    '/agent/flag',
    {
      reviewRunId: adminRun.body.reviewRunId,
      clauseId: risky.clauseId,
      riskLevel: 'high',
      rationale: 'Caps liability — high risk; sign-off needs approve authority.'
    },
    token,
    ADMIN
  );

  // 5. The INTERN's Sign-off approval of the risky clause — DENIED.
  const internRun = await agent(
    '/agent/review/start',
    {contractId},
    token,
    INTERN
  );
  const internApprove = await agent(
    '/agent/approve',
    {reviewRunId: internRun.body.reviewRunId, clauseId: risky.clauseId},
    token,
    INTERN
  );

  // 6. The ADMIN's Sign-off approval of the same clause — ALLOWED.
  const adminApprove = await agent(
    '/agent/approve',
    {reviewRunId: adminRun.body.reviewRunId, clauseId: risky.clauseId},
    token,
    ADMIN
  );

  // 7. Persisted state + audit rows.
  const listOut = run('npx', [
    'convex',
    'run',
    'contracts:listClausesByContract',
    JSON.stringify({contractId})
  ]);
  const persisted = extractJson<
    Array<{_id: string; status: string; decidedBy?: string; riskLevel: string}>
  >(listOut, '[', ']').find((c) => c._id === risky.clauseId)!;

  const audit = extractJson<
    Array<{
      eventType: string;
      decision: string | null;
      action: string | null;
      reason: string | null;
      callerSubject: string | null;
      scopesUsed: string[] | null;
      correlationId: string | null;
    }>
  >(
    run('npx', [
      'convex',
      'run',
      'agentDelegation:recentAudit',
      JSON.stringify({orgCode: ORG, limit: 8})
    ]),
    '[',
    ']'
  );

  console.log('\n================= EVIDENCE (intersection) =================');
  console.log(
    `Risky clause   : "${risky.text.slice(0, 55)}..."  riskLevel=${persisted.riskLevel}`
  );
  console.log(`\nINTERN approve : HTTP ${internApprove.status}`);
  console.log(`  reason        : ${String(internApprove.body.reason)}`);
  console.log(
    `  requiredScopes: ${JSON.stringify(internApprove.body.requiredScopes)}`
  );
  console.log(`  correlationId : ${String(internApprove.body.correlationId)}`);
  console.log(
    `\nADMIN approve  : HTTP ${adminApprove.status}  status=${String(adminApprove.body.status)}`
  );
  console.log(
    `\nPersisted clause: status=${persisted.status}  decidedBy=${persisted.decidedBy}`
  );
  console.log(
    '\nComponent audit rows (decision → action → ceiling → correlationId):'
  );
  for (const r of audit.filter((a) => a.decision !== null).slice(0, 4)) {
    console.log(
      `  ${r.decision}\t action=${r.action}\t reason=${r.reason}\t ceiling(scopesUsed)=${JSON.stringify(r.scopesUsed)}\t caller=${r.callerSubject}\t correlationId=${r.correlationId}`
    );
  }
  console.log('==========================================================\n');

  const internDenied =
    internApprove.status === 403 &&
    internApprove.body.reason === 'insufficient_scope' &&
    !!internApprove.body.correlationId;
  const adminAllowed =
    adminApprove.status === 200 && adminApprove.body.status === 'approved';
  const clauseApprovedByAdmin =
    persisted.status === 'approved' && persisted.decidedBy === ADMIN;

  if (internDenied && adminAllowed && clauseApprovedByAdmin) {
    console.log(
      '✅ FIX VERIFIED: the read-only Intern’s approval is DENIED (insufficient_scope\n' +
        '   + correlationId + audit row), the clause is NOT approved by the Intern, and\n' +
        '   the Admin — who holds clauses:approve — IS allowed. Human ∩ agent.'
    );
    process.exit(0);
  }
  console.error(
    `❌ Fix not verified: internDenied=${internDenied} adminAllowed=${adminAllowed} clauseApprovedByAdmin=${clauseApprovedByAdmin}`
  );
  process.exit(1);
}

main().catch((err) => {
  console.error('repro error:', err instanceof Error ? err.message : err);
  process.exit(2);
});
