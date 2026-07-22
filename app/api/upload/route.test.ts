import {describe, test, expect, vi, beforeEach, afterEach} from 'vitest';

/**
 * /api/upload ingests a plain-text contract for the acting org and embeds it.
 * The org + uploader come from the acting identity (server-side), never the
 * client; the ingest+embed itself is covered by the shared helper (mocked here).
 */

const getActingIdentity = vi.fn();
vi.mock('@/lib/acting-identity', () => ({
  getActingIdentity: () => getActingIdentity()
}));

const ingestAndEmbed = vi.fn();
vi.mock('@/lib/ingest-contract', () => ({
  ingestAndEmbed: (...args: unknown[]) => ingestAndEmbed(...args)
}));

import {POST} from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/upload', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  ingestAndEmbed.mockResolvedValue({
    ok: true,
    status: 200,
    contractId: 'k1',
    clauseCount: 7,
    embedded: 7,
    embedError: null
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  ingestAndEmbed.mockReset();
  getActingIdentity.mockReset();
});

describe('POST /api/upload', () => {
  test('rejects when there is no acting identity', async () => {
    getActingIdentity.mockResolvedValue({subject: null, orgCode: null});
    const res = await POST(
      makeReq({title: 't', text: 'x'.repeat(40)}) as never
    );
    expect(res.status).toBe(401);
    expect(ingestAndEmbed).not.toHaveBeenCalled();
  });

  test('ingests for the acting org and returns the new contract', async () => {
    getActingIdentity.mockResolvedValue({
      subject: 'kp_intern',
      orgCode: 'org_demo'
    });
    const res = await POST(
      makeReq({title: 'My NDA', text: 'A '.repeat(40)}) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contractId).toBe('k1');
    expect(body.clauseCount).toBe(7);

    // Org + uploader come from the identity, not the request body.
    const arg = ingestAndEmbed.mock.calls[0][0];
    expect(arg.orgCode).toBe('org_demo');
    expect(arg.subject).toBe('kp_intern');
    expect(arg.title).toBe('My NDA');
  });

  test('surfaces a helper error with its status', async () => {
    getActingIdentity.mockResolvedValue({
      subject: 'kp_intern',
      orgCode: 'org_demo'
    });
    ingestAndEmbed.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'text_too_short',
      message: 'That file has too little text to review.'
    });
    const res = await POST(makeReq({title: 't', text: 'hi'}) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('text_too_short');
  });
});
