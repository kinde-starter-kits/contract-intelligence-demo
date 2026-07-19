/**
 * The whole article arc as ONE runnable pass, against the real stack. It
 * orchestrates the existing scripts (it does not re-implement their logic) and
 * asserts each step; exits non-zero if any assertion fails.
 *
 *   reset → BROKEN (crew as Intern → intern APPROVES a high-risk clause)
 *         → reset → INTERSECTION (crew as Intern → DENIED 403 insufficient_scope
 *           + correlationId; Admin → ALLOWED) → audit trail matches
 *         → restore AUTHZ_MODE=intersection + clean demo state.
 *
 * Reuses: demoReset:resetDemoOrg, lib/weaviate.clearOrgClauses,
 * scripts/repro-confused-deputy.ts, scripts/repro-intersection-fix.ts,
 * agentDelegation:recentAudit, scripts/reset-demo.ts.
 *
 *   npx tsx scripts/e2e-narrative.ts
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withWeaviate, clearOrgClauses} from '../lib/weaviate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORG = 'org_d8d0c41009eb1';
// The Intern's ceiling in the deny audit row is `[contracts:read]` (resolved
// from Kinde); the Admin's allow row includes `clauses:approve`.

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
if (localEnv.WEAVIATE_URL) process.env.WEAVIATE_URL = localEnv.WEAVIATE_URL;
if (localEnv.WEAVIATE_API_KEY)
  process.env.WEAVIATE_API_KEY = localEnv.WEAVIATE_API_KEY;

function banner(title: string) {
  console.log(`\n${'#'.repeat(74)}\n#  ${title}\n${'#'.repeat(74)}\n`);
}

/** Run a command with retry on transient failure; returns stdout, throws on non-zero. */
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

/** Run a child tsx script, print its output, and FAIL the pass if it exits non-zero. */
function runScript(rel: string): string {
  try {
    const out = execFileSync('npx', ['tsx', rel], {
      encoding: 'utf-8',
      cwd: root,
      stdio: ['inherit', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024
    });
    console.log(out);
    return out;
  } catch (e) {
    const err = e as {stdout?: string; stderr?: string};
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    throw new Error(`STEP FAILED: ${rel} exited non-zero`);
  }
}

function extractJson<T>(s: string, open: string, close: string): T {
  const a = s.indexOf(open);
  const b = s.lastIndexOf(close);
  if (a === -1 || b === -1) throw new Error(`No JSON in: ${s}`);
  return JSON.parse(s.slice(a, b + 1)) as T;
}

async function resetOrg(label: string) {
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
    ]),
    '{',
    '}'
  );
  await withWeaviate((c) => clearOrgClauses(c, ORG));
  console.log(
    `[${label}] cleared org: ${del.contracts} contracts, ${del.clauses} clauses, ${del.reviewRuns} runs + Weaviate tenant.`
  );
}

async function main() {
  const failures: string[] = [];

  banner('STEP 1 — reset to a clean demo state');
  await resetOrg('reset');

  banner(
    'STEP 2 — AUTHZ_MODE=broken: the crew, acting for the Intern, APPROVES a high-risk clause'
  );
  // repro-confused-deputy asserts internally (exit 0 => intern's approval landed).
  runScript('scripts/repro-confused-deputy.ts');

  banner(
    'STEP 3 — reset clause state (drop the broken-mode contract + approval)'
  );
  await resetOrg('reset');

  banner(
    'STEP 4 — AUTHZ_MODE=intersection: Intern DENIED (403), Admin ALLOWED (ceiling from Kinde)'
  );
  const interOut = runScript('scripts/repro-intersection-fix.ts');

  banner(
    'STEP 5 — assert the audit trail matches (deny=intern, allow=admin, with correlationIds)'
  );
  // The Intern's denial correlationId, parsed from the intersection repro output.
  const m = interOut.match(
    /INTERN approve[\s\S]*?correlationId\s*:\s*([0-9a-fA-F-]{36})/
  );
  const internCorr = m?.[1] ?? null;
  console.log(
    `Intern deny correlationId (from repro): ${internCorr ?? 'NOT FOUND'}`
  );

  type AuditRow = {
    decision: string | null;
    action: string | null;
    reason: string | null;
    scopesUsed: string[] | null;
    correlationId: string | null;
  };
  const audit = extractJson<AuditRow[]>(
    run('npx', [
      'convex',
      'run',
      'agentDelegation:recentAudit',
      JSON.stringify({orgCode: ORG, limit: 15})
    ]),
    '[',
    ']'
  );
  const denyRow = audit.find(
    (r) =>
      r.decision === 'deny' &&
      r.action === 'clauses:approve' &&
      (internCorr ? r.correlationId === internCorr : true) &&
      Array.isArray(r.scopesUsed) &&
      r.scopesUsed.length === 1 &&
      r.scopesUsed[0] === 'contracts:read'
  );
  const allowRow = audit.find(
    (r) =>
      r.decision === 'allow' &&
      r.action === 'clauses:approve' &&
      Array.isArray(r.scopesUsed) &&
      r.scopesUsed.includes('clauses:approve')
  );

  if (denyRow) {
    console.log(
      `  ✔ deny row: action=${denyRow.action} reason=${denyRow.reason} ceiling=${JSON.stringify(denyRow.scopesUsed)} correlationId=${denyRow.correlationId}`
    );
  } else {
    failures.push(
      'audit: no matching Intern deny row (clauses:approve, ceiling [contracts:read])'
    );
  }
  if (allowRow) {
    console.log(
      `  ✔ allow row: action=${allowRow.action} reason=${allowRow.reason} ceiling=${JSON.stringify(allowRow.scopesUsed)} correlationId=${allowRow.correlationId}`
    );
  } else {
    failures.push(
      'audit: no matching Admin allow row (clauses:approve in ceiling)'
    );
  }
  if (internCorr && !denyRow) {
    failures.push(
      `audit: Intern deny correlationId ${internCorr} not found in the trail`
    );
  }

  banner('STEP 6 — restore AUTHZ_MODE=intersection + leave a clean demo state');
  runScript('scripts/reset-demo.ts'); // ends with AUTHZ_MODE=intersection + a clean contract

  banner('RESULT');
  if (failures.length === 0) {
    console.log(
      '✅ NARRATIVE PASS — broken: Intern approved a high-risk clause; intersection:\n' +
        '   Intern DENIED (403 insufficient_scope + correlationId), Admin ALLOWED; audit\n' +
        '   trail contains the matching deny (intern ceiling [contracts:read]) and allow\n' +
        '   (admin) rows. The whole before/after proven in one pass.'
    );
    process.exit(0);
  }
  console.error('❌ NARRATIVE FAILED:');
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('\ne2e error:', err instanceof Error ? err.message : err);
  process.exit(2);
});
