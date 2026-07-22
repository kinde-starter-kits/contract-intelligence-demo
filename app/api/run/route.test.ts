import {describe, test, expect, vi, beforeEach, afterEach} from 'vitest';

/**
 * /api/run has two paths:
 *   - deterministic (default): SELF-CONTAINED — drives the run via the shared
 *     server-side driver (no external service). Proven end-to-end against the
 *     real crew endpoints in convex/authzIntersection.test.ts; here we assert the
 *     route wires the driver with a server-derived acting subject.
 *   - crew (BYOK): forwards the visitor's key to the crew service ONLY when
 *     CREW_SERVICE_URL is set; the key is used once, never persisted, never
 *     logged. The acting subject is taken server-side, not from the client.
 */

const getActingIdentity = vi.fn();
vi.mock('@/lib/acting-identity', () => ({
  getActingIdentity: () => getActingIdentity()
}));

const mintCrewToken = vi.fn();
const runDeterministicReview = vi.fn();
vi.mock('@/lib/agent-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-run')>();
  return {
    ...actual, // keep the real siteCrewPost + RunError
    mintCrewToken: () => mintCrewToken(),
    runDeterministicReview: (...args: unknown[]) =>
      runDeterministicReview(...args)
  };
});

import {POST} from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/run', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body)
  });
}

const SECRET = 'sk-byok-must-not-leak';
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_CONVEX_SITE_URL', 'https://dep.convex.site');
  vi.stubEnv('CREW_SERVICE_URL', '');
  mintCrewToken.mockResolvedValue('crew-token');
  runDeterministicReview.mockResolvedValue({
    reviewRunId: 'run_1',
    mode: 'broken',
    totalClauses: 3,
    flagged: 3,
    approved: 1,
    denied: 0
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  getActingIdentity.mockReset();
});

describe('POST /api/run', () => {
  test('rejects when there is no acting identity', async () => {
    getActingIdentity.mockResolvedValue({subject: null});
    const res = await POST(makeReq({contractId: 'c1'}) as never);
    expect(res.status).toBe(401);
  });

  test('deterministic (default) drives the self-contained run for the acting subject', async () => {
    getActingIdentity.mockResolvedValue({subject: 'kp_admin'});
    const res = await POST(makeReq({contractId: 'c1'}) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.summary.reviewRunId).toBe('run_1');

    // Driven via the shared driver with the contract id; no LLM key involved and
    // the crew service is never contacted.
    expect(runDeterministicReview).toHaveBeenCalledTimes(1);
    expect(runDeterministicReview.mock.calls[0][1]).toBe('c1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('crew mode requires a key — and sends nothing without one', async () => {
    getActingIdentity.mockResolvedValue({subject: 'kp_admin'});
    const res = await POST(makeReq({contractId: 'c1', mode: 'crew'}) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('byok_key_required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('crew mode with a key but no service URL fails clearly (no bogus request)', async () => {
    getActingIdentity.mockResolvedValue({subject: 'kp_admin'});
    const res = await POST(
      makeReq({contractId: 'c1', mode: 'crew', apiKey: SECRET}) as never
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('crew_service_unconfigured');
    // Critically: nothing is sent, so the key cannot leak to a wrong host.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('crew mode forwards the key to the configured service but never persists or logs it', async () => {
    getActingIdentity.mockResolvedValue({subject: 'kp_admin'});
    vi.stubEnv('CREW_SERVICE_URL', 'http://localhost:8790');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({review_run_id: 'run_1'}), {status: 200})
    );

    const res = await POST(
      makeReq({contractId: 'c1', mode: 'crew', apiKey: SECRET}) as never
    );
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:8790/run');
    const sent = JSON.parse(init.body as string);
    expect(sent.apiKey).toBe(SECRET);
    expect(sent.actingSubject).toBe('kp_admin'); // server-derived, not client

    const text = await res.clone().text();
    expect(text).not.toContain(SECRET);
    for (const spy of [logSpy, errSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SECRET);
      }
    }
  });

  test('maps a provider rejection to a friendly, key-free error', async () => {
    getActingIdentity.mockResolvedValue({subject: 'kp_admin'});
    vi.stubEnv('CREW_SERVICE_URL', 'http://localhost:8790');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({detail: 'llm_key_rejected'}), {status: 400})
    );

    const res = await POST(
      makeReq({contractId: 'c1', mode: 'crew', apiKey: SECRET}) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('llm_key_rejected');
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});
