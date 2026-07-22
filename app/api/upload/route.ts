import {NextRequest, NextResponse} from 'next/server';
import {getActingIdentity} from '@/lib/acting-identity';
import {ingestAndEmbed} from '@/lib/ingest-contract';

// Node runtime: embedding clauses uses Transformers.js (ONNX), which can't run
// on the edge — the same reason vector similarity is a Next.js route.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Upload a plain-text contract and make it reviewable. The browser reads the
 * .txt and posts its text here; we resolve the acting identity (guest or Kinde)
 * server-side, then ingest + embed via the shared pipeline. The client never
 * chooses the org — it comes from the acting identity.
 */
export async function POST(req: NextRequest) {
  const identity = await getActingIdentity();
  if (!identity.subject || !identity.orgCode) {
    return NextResponse.json({error: 'no_acting_identity'}, {status: 401});
  }

  const body = await req.json().catch(() => ({}));
  const rawTitle = typeof body?.title === 'string' ? body.title.trim() : '';
  const text = typeof body?.text === 'string' ? body.text : '';
  const title = rawTitle || 'Untitled contract';

  const result = await ingestAndEmbed({
    subject: identity.subject,
    orgCode: identity.orgCode,
    title,
    text
  });

  return NextResponse.json(
    result.ok
      ? {
          ok: true,
          contractId: result.contractId,
          clauseCount: result.clauseCount,
          embedded: result.embedded,
          embedError: result.embedError
        }
      : {error: result.error, message: result.message},
    {status: result.status}
  );
}
