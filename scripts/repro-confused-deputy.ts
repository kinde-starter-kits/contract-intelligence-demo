/**
 * Reproduce the confused deputy (AUTHZ_MODE=broken).
 *
 * A read-only Intern triggers a contract review; the crew — acting on the
 * Intern's behalf but on its OWN broad M2M authority — approves a HIGH-risk
 * clause the Intern could never approve. In broken mode the app authorizes on
 * the agent's identity alone and NEVER consults the acting human's permissions.
 *
 * This script:
 *   1. forces AUTHZ_MODE=broken on the deployment,
 *   2. ingests + embeds a fixture,
 *   3. runs the crew (deterministic) on behalf of the INTERN subject,
 *   4. as the Intern, flags a risky clause HIGH and APPROVES it via the app,
 *   5. asserts the approval LANDED (status=approved, decidedBy=intern,
 *      humanChecked=false) — i.e. the failure is real.
 *
 * Exits non-zero if the approval did NOT land (failure not reproduced).
 *
 *   npx tsx scripts/repro-confused-deputy.ts
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORG = 'org_d8d0c41009eb1';
const INTERN = 'kp_0d4f620753b84b06b32a5738c1fc6f1c'; // read-only human: Intern has ONLY contracts:read

// --- env from agents/.env (crew creds + endpoints) ---
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

/** Run a command, retrying transient failures (e.g. a flaky network to Convex). */
function run(cmd: string, args: string[], opts: {cwd?: string} = {}): string {
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      return execFileSync(cmd, args, {
        encoding: 'utf-8',
        cwd: opts.cwd ?? root
      });
    } catch (err) {
      lastErr = err;
      execFileSync('sleep', [String(1.5 * (i + 1))]);
    }
  }
  throw lastErr;
}

async function fetchRetry(
  url: string,
  init: RequestInit,
  attempts = 4
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

function extractJson<T>(stdout: string): T {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1)
    throw new Error(`No JSON in output: ${stdout}`);
  return JSON.parse(stdout.slice(start, end + 1)) as T;
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
  if (!resp.ok) throw new Error(`token mint failed: ${resp.status}`);
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
  console.log('== Confused-deputy reproduction ==\n');

  // 1. Force broken mode (server-decided).
  run('npx', ['convex', 'env', 'set', 'AUTHZ_MODE', 'broken']);
  console.log('AUTHZ_MODE=broken set on the deployment.\n');

  // 2. Ingest + embed a fixture.
  const text = readFileSync(join(root, 'fixtures', 'acme-msa.txt'), 'utf-8');
  const ingestOut = run('npx', [
    'convex',
    'run',
    'ingest:ingestContractText',
    JSON.stringify({
      orgCode: ORG,
      uploadedBy: INTERN,
      title: 'Acme MSA (confused-deputy repro)',
      text
    })
  ]);
  const {contractId} = extractJson<{contractId: string}>(ingestOut);
  console.log(`Ingested contract ${contractId}.`);
  run('npx', ['tsx', 'scripts/embed-contract.ts', contractId, ORG]);
  console.log('Embedded clauses into Weaviate.\n');

  // 3. Run the crew (deterministic) on behalf of the read-only INTERN.
  console.log(`Running the crew on behalf of ${INTERN} (Intern, read-only)...`);
  const crewOut = run(
    join(root, 'agents', '.venv', 'bin', 'python'),
    [
      '-m',
      'contract_crew.main',
      '--contract-id',
      contractId,
      '--acting-subject',
      INTERN,
      '--mode',
      'deterministic'
    ],
    {cwd: join(root, 'agents')}
  );
  // Show the crew's summary (skip the best-effort "similar retrieval skipped"
  // lines — the vector route only runs when the Next.js app is up, which the
  // authz repro doesn't require).
  console.log(
    crewOut
      .trim()
      .split('\n')
      .filter((l) => !l.includes('similar retrieval skipped'))
      .join('\n')
  );
  console.log(
    '...(crew acted as the intern: flagged clauses, approved the low-risk ones)\n'
  );

  // 4. As the Intern, flag a RISKY clause HIGH and APPROVE it — the harmful act.
  const token = await mintToken();
  const start = await agent('/agent/review/start', {contractId}, token, INTERN);
  const reviewRunId = start.body.reviewRunId as string;
  console.log(
    `Effective mode reported by the server: ${String(start.body.mode)}`
  );

  const clausesResp = await agent(
    '/agent/clauses',
    {contractId},
    token,
    INTERN
  );
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
      reviewRunId,
      clauseId: risky.clauseId,
      riskLevel: 'high',
      rationale:
        'Caps liability — high risk; needs a human with approve authority.'
    },
    token,
    INTERN
  );
  const approve = await agent(
    '/agent/approve',
    {reviewRunId, clauseId: risky.clauseId},
    token,
    INTERN
  );

  // 5. Verify the persisted state via the public query (includes decidedBy).
  const listOut = run('npx', [
    'convex',
    'run',
    'contracts:listClausesByContract',
    JSON.stringify({contractId})
  ]);
  const allClauses = JSON.parse(
    listOut.slice(listOut.indexOf('['), listOut.lastIndexOf(']') + 1)
  ) as Array<{
    _id: string;
    status: string;
    decidedBy?: string;
    riskLevel: string;
  }>;
  const persisted = allClauses.find((c) => c._id === risky.clauseId)!;

  console.log('\n================= EVIDENCE =================');
  console.log(
    `Acting human   : ${INTERN}  (role Intern — read only; NO clauses:approve)`
  );
  console.log(
    `Risky clause   : "${risky.text.slice(0, 60)}..."  riskLevel=${persisted.riskLevel}`
  );
  console.log(`Approve authz  : ${JSON.stringify(approve.body.authz)}`);
  console.log(
    `Persisted row  : status=${persisted.status}  decidedBy=${persisted.decidedBy}  riskLevel=${persisted.riskLevel}`
  );
  console.log('===========================================\n');

  const approveAuthz = approve.body.authz as
    {humanChecked?: boolean} | undefined;
  const landed =
    approve.status === 200 &&
    approve.body.status === 'approved' &&
    approveAuthz?.humanChecked === false &&
    persisted.status === 'approved' &&
    persisted.decidedBy === INTERN;

  if (landed) {
    console.log(
      '✅ FAILURE REPRODUCED: a read-only Intern’s proxy APPROVED a high-risk clause.\n' +
        '   No human-permission check occurred anywhere in the decision path\n' +
        '   (authz.humanChecked=false). This is the confused deputy.'
    );
    process.exit(0);
  }
  console.error('❌ Approval did NOT land — failure not reproduced.');
  process.exit(1);
}

main().catch((err) => {
  console.error('repro error:', err instanceof Error ? err.message : err);
  process.exit(2);
});
