/**
 * Embed a contract's clauses into Weaviate (client-side vectors), under the
 * org's tenant. This is the app-side embedding step that pairs with the Convex
 * ingestion (which writes the structured clause rows): Convex owns the rows,
 * the app owns the vectors.
 *
 * Usage:
 *   npx tsx scripts/embed-contract.ts <contractId> <orgCode>
 *
 * Pulls the clause records from Convex via `internal.ingest.getClauseRecords`
 * (admin CLI) and stores their vectors in the org's Weaviate tenant.
 */
import {execFileSync} from 'node:child_process';
import {
  connectWeaviate,
  upsertClauses,
  type ClauseRecord
} from '../lib/weaviate';

/** Run a command, retrying transient failures (e.g. a flaky network to Convex). */
function runWithRetry(cmd: string, args: string[], attempts = 4): string {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return execFileSync(cmd, args, {encoding: 'utf-8'});
    } catch (err) {
      lastErr = err;
      const wait = 1500 * (i + 1);
      execFileSync('sleep', [String(wait / 1000)]);
    }
  }
  throw lastErr;
}

async function main() {
  const [, , contractId, orgCode] = process.argv;
  if (!contractId || !orgCode) {
    console.error(
      'Usage: npx tsx scripts/embed-contract.ts <contractId> <orgCode>'
    );
    process.exit(1);
  }

  const raw = runWithRetry('npx', [
    'convex',
    'run',
    'ingest:getClauseRecords',
    JSON.stringify({contractId})
  ]);
  const records = JSON.parse(raw) as ClauseRecord[];
  if (records.length === 0) {
    console.error('No clauses found for that contract.');
    process.exit(1);
  }

  const client = await connectWeaviate();
  try {
    const n = await upsertClauses(client, orgCode, records);
    console.log(
      `Embedded ${n} clauses for contract ${contractId} into Weaviate tenant ${orgCode}.`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
