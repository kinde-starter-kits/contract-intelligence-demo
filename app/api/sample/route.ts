import {NextResponse} from 'next/server';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {getActingIdentity} from '@/lib/acting-identity';
import {ingestAndEmbed} from '@/lib/ingest-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Load the sample contract (the Acme MSA fixture) into the acting org, so a
 * first-time visitor always has something to review. Same ingest + embed path as
 * a real upload.
 */
export async function POST() {
  const identity = await getActingIdentity();
  if (!identity.subject || !identity.orgCode) {
    return NextResponse.json({error: 'no_acting_identity'}, {status: 401});
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
    title: 'Acme Master Services Agreement (sample)',
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
