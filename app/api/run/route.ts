import {NextRequest, NextResponse} from 'next/server';
import {getActingIdentity} from '@/lib/acting-identity';
import {errorText} from '@/lib/error-text';
import {
  RunError,
  mintCrewToken,
  runDeterministicReview,
  siteCrewPost
} from '@/lib/agent-run';

/**
 * Run trigger for the "Run review" button.
 *
 *  - mode: 'deterministic' (default) — SELF-CONTAINED. The server drives the
 *    Convex crew endpoints itself (as the crew M2M, on behalf of the acting
 *    human) and streams the full event sequence. Works in broken AND
 *    intersection modes with no external service and no LLM key. This is the
 *    reliable demo path.
 *  - mode: 'crew' (BYOK) — forwards to the Python crew HTTP service (the real
 *    LLM crew) with the visitor's key in the request body, used once and never
 *    persisted/logged. Requires CREW_SERVICE_URL to be configured.
 *
 * The acting subject is resolved SERVER-side (guest or Kinde); the client cannot
 * choose whom the crew acts for. Only the LLM key + contract id come from the
 * client.
 */

const FRIENDLY: Record<string, string> = {
  byok_key_required: 'Add your own LLM API key to run the crew.',
  llm_key_rejected: 'That LLM key was rejected by the provider.',
  invalid_mode: 'Invalid run mode.',
  crew_run_failed: 'The crew run failed. Check the crew service logs.',
  crew_service_unconfigured:
    'The BYOK crew service is not configured. Set CREW_SERVICE_URL (or use Deterministic mode).',
  crew_service_unreachable: 'Could not reach the crew service.'
};

function fail(code: string, status: number) {
  return NextResponse.json(
    {error: code, message: FRIENDLY[code] ?? undefined},
    {status}
  );
}

export async function POST(req: NextRequest) {
  const identity = await getActingIdentity();
  if (!identity.subject) {
    return NextResponse.json({error: 'no_acting_identity'}, {status: 401});
  }

  const body = await req.json().catch(() => ({}));
  const contractId =
    typeof body?.contractId === 'string' ? body.contractId : '';
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  const model = typeof body?.model === 'string' ? body.model : undefined;
  // Default to the self-contained deterministic run; crew (BYOK) is opt-in.
  const mode = body?.mode === 'crew' ? 'crew' : 'deterministic';

  if (!contractId) {
    return NextResponse.json({error: 'contract_required'}, {status: 400});
  }

  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!site) return fail('crew_service_unreachable', 500);

  // --- Self-contained deterministic run (drives Convex directly) ---
  if (mode === 'deterministic') {
    let token: string;
    try {
      token = await mintCrewToken();
    } catch (e) {
      return NextResponse.json(
        {
          error: 'mint_failed',
          message: errorText(e, 'Could not mint crew token.')
        },
        {status: 502}
      );
    }
    try {
      const post = siteCrewPost(site, token, identity.subject);
      const summary = await runDeterministicReview(post, contractId);
      return NextResponse.json({ok: true, summary});
    } catch (e) {
      if (e instanceof RunError) {
        return NextResponse.json(
          {error: e.code, message: errorText(e.detail ?? e.code, e.code)},
          {status: e.status >= 400 ? e.status : 502}
        );
      }
      return NextResponse.json(
        {error: 'run_failed', message: errorText(e, 'The run failed.')},
        {status: 502}
      );
    }
  }

  // --- BYOK crew (LLM) run — forwards to the Python crew service ---
  if (!apiKey) return fail('byok_key_required', 400);
  const crewServiceUrl = process.env.CREW_SERVICE_URL;
  if (!crewServiceUrl) return fail('crew_service_unconfigured', 503);

  let upstream: Response;
  try {
    upstream = await fetch(`${crewServiceUrl}/run`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        contractId,
        actingSubject: identity.subject,
        apiKey,
        model,
        mode: 'crew'
      })
    });
  } catch {
    return fail('crew_service_unreachable', 502);
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    // The upstream error can be a string code, an object, or a FastAPI 422 array
    // — coerce to a stable string so `error` is always renderable, never an
    // object.
    const code = errorText(data?.detail ?? data?.error, 'crew_run_failed');
    return NextResponse.json(
      {error: code, message: FRIENDLY[code] ?? undefined},
      {status: upstream.status}
    );
  }

  return NextResponse.json({ok: true, summary: data});
}
