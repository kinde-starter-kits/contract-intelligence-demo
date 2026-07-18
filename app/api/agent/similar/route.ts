import {NextRequest} from 'next/server';
import {ConvexHttpClient} from 'convex/browser';
import {api} from '@/convex/_generated/api';
import {connectWeaviate, retrieveSimilarClauses} from '@/lib/weaviate';

// Node runtime: this route embeds the query with Transformers.js (ONNX), which
// can't run on the edge — and is exactly why vector similarity is a Next.js
// route rather than a Convex httpAction.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function bearer(req: NextRequest): string | null {
  const header = req.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

/**
 * POST /api/agent/similar  { text, limit? }
 * Headers: Authorization: Bearer <crew M2M token>
 *
 * Verifies the crew token via the component (`verifyAgentToken`), then returns
 * nearest-neighbor clauses within the verified org's Weaviate tenant. The org
 * comes from the verified token — never from the request — so the crew can only
 * ever retrieve its own org's clauses.
 */
export async function POST(req: NextRequest) {
  const token = bearer(req);
  if (!token) {
    return Response.json({error: 'missing_bearer_token'}, {status: 401});
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return Response.json({error: 'convex_url_unconfigured'}, {status: 500});
  }

  const convex = new ConvexHttpClient(convexUrl);
  let verified;
  try {
    verified = await convex.action(api.agentIdentity.verifyAgentToken, {token});
  } catch (e) {
    return Response.json(
      {
        error: 'invalid_token',
        detail: e instanceof Error ? e.message : String(e)
      },
      {status: 401}
    );
  }
  if (!verified.orgCode) {
    return Response.json({error: 'token_not_bound_to_org'}, {status: 403});
  }

  let body: {text?: string; limit?: number};
  try {
    body = await req.json();
  } catch {
    return Response.json({error: 'invalid_json'}, {status: 400});
  }
  if (!body.text) {
    return Response.json({error: 'missing_text'}, {status: 400});
  }

  const client = await connectWeaviate();
  try {
    const matches = await retrieveSimilarClauses(
      client,
      verified.orgCode,
      body.text,
      body.limit ?? 3
    );
    return Response.json({matches});
  } catch (e) {
    return Response.json(
      {
        error: 'retrieval_failed',
        detail: e instanceof Error ? e.message : String(e)
      },
      {status: 500}
    );
  } finally {
    await client.close();
  }
}
