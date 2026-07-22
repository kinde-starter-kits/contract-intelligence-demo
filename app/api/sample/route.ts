import {NextResponse} from 'next/server';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fetchQuery} from 'convex/nextjs';
import {api} from '@/convex/_generated/api';
import {getActingIdentity} from '@/lib/acting-identity';
import {ingestAndEmbed} from '@/lib/ingest-contract';
import {SAMPLE_CONTRACT_TITLE} from '@/lib/sample';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Load the sample contract (the Acme MSA fixture) into the acting org, so a
 * first-time visitor always has something to review. Same ingest + embed path as
 * a real upload.
 *
 * Idempotent by design: if the org already holds the sample (by canonical
 * title), we reuse it instead of inserting another copy. This is what keeps the
 * "Pick a contract" list from piling up duplicate samples every time someone
 * clicks "Load the sample" — repeated clicks always resolve to the one sample.
 */
export async function POST() {
  const identity = await getActingIdentity();
  if (!identity.subject || !identity.orgCode) {
    return NextResponse.json({error: 'no_acting_identity'}, {status: 401});
  }

  // Reuse an existing sample rather than blind-inserting a duplicate.
  try {
    const existing = await fetchQuery(api.contracts.listContractsByOrg, {
      orgCode: identity.orgCode
    });
    const match = existing.find((c) => c.title === SAMPLE_CONTRACT_TITLE);
    if (match) {
      return NextResponse.json({
        ok: true,
        contractId: match._id,
        reused: true
      });
    }
  } catch {
    // If the lookup fails we fall through to a fresh ingest — the demo still
    // works; at worst a duplicate could appear, which the reset flow cleans up.
  }

  let text: string;
  try {
    text = await readFile(
      join(process.cwd(), 'fixtures', 'acme-msa.txt'),
      'utf-8'
    );
  } catch {
    return NextResponse.json({error: 'sample_missing'}, {status: 500});
  }

  const result = await ingestAndEmbed({
    subject: identity.subject,
    orgCode: identity.orgCode,
    title: SAMPLE_CONTRACT_TITLE,
    text
  });

  return NextResponse.json(
    result.ok
      ? {
          ok: true,
          contractId: result.contractId,
          clauseCount: result.clauseCount
        }
      : {error: result.error, message: result.message},
    {status: result.status}
  );
}
