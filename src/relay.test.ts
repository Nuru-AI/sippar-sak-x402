import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probeService, getCredential, fetchWithCredential } from './relay.js';
import type { ServicePaymentRequirements, X402Credential } from './types.js';

const SERVICE = 'https://mesh.heurist.xyz/x402/agents/TrendingTokenAgent/get_trending_tokens';

const ACCEPTS_402 = {
  x402Version: 1,
  error: 'X-PAYMENT header is required',
  accepts: [
    {
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: '2000',
      payTo: '0xA112c9C8BF655c678c768B6fD42a1C6FbfeD7D60',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      description: 'trending tokens',
      mimeType: 'application/json',
    },
  ],
};

const REQ: ServicePaymentRequirements = {
  payTo: '0xA112c9C8BF655c678c768B6fD42a1C6FbfeD7D60',
  amount: '2000',
  network: 'base',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  accepted: ACCEPTS_402.accepts[0],
};

const CRED: X402Credential = {
  signature: '0xsig',
  authorization: { from: '0x07fB', to: REQ.payTo, value: '2000', nonce: '0xnonce' },
  network: 'base',
};

function mockFetch(impl: (url: string, init: RequestInit) => Response) {
  const spy = vi.fn(async (url: unknown, init: unknown) =>
    impl(String(url), (init ?? {}) as RequestInit),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.SIPPAR_ACCESS_TOKEN = 'test-token';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeService', () => {
  it('parses the accepts[] 402 (even when x402Version is 1)', async () => {
    mockFetch(() => new Response(JSON.stringify(ACCEPTS_402), { status: 402 }));
    const req = await probeService(SERVICE, 'POST', {});
    expect(req.payTo).toBe(REQ.payTo);
    expect(req.amount).toBe('2000');
    expect(req.network).toBe('base');
    expect(req.accepted).toBeTruthy();
  });

  it('posts to the SERVICE, not to Sippar', async () => {
    const spy = mockFetch(() => new Response(JSON.stringify(ACCEPTS_402), { status: 402 }));
    await probeService(SERVICE, 'POST', { q: 1 });
    const [url] = spy.mock.calls[0];
    expect(String(url)).toBe(SERVICE);
  });

  it('throws when the service does not return 402', async () => {
    mockFetch(() => new Response('ok', { status: 200 }));
    await expect(probeService(SERVICE, 'POST', {})).rejects.toThrow(/Expected 402/);
  });

  it('refuses non-https / private service URLs', async () => {
    await expect(probeService('http://svc.example.com/x', 'POST', {})).rejects.toThrow(/HTTPS/i);
    await expect(probeService('https://127.0.0.1/x', 'POST', {})).rejects.toThrow(/Private/i);
  });
});

describe('getCredential', () => {
  it('returns the signed payload and sends the access token + solana source body', async () => {
    const spy = mockFetch(
      () =>
        new Response(
          JSON.stringify({ success: true, credential: { network: 'base', payload: { signature: CRED.signature, authorization: CRED.authorization } } }),
          { status: 200 },
        ),
    );
    const cred = await getCredential({ sourcePaymentTx: 'SOLSIG', destChain: 'base', payTo: REQ.payTo, amount: '2000' });
    expect(cred.signature).toBe('0xsig');
    expect(cred.network).toBe('base');
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('sippar.network');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Sippar-Access']).toBe('test-token');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      sourceChain: 'solana',
      sourcePaymentTx: 'SOLSIG',
      destChain: 'base',
      payTo: REQ.payTo,
      amount: '2000',
    });
  });

  it('throws a clear error when the gate rejects the token', async () => {
    mockFetch(() => new Response('forbidden', { status: 403 }));
    await expect(
      getCredential({ sourcePaymentTx: 'X', destChain: 'base', payTo: REQ.payTo, amount: '2000' }),
    ).rejects.toThrow(/access token/i);
  });

  it('throws when Sippar reports success:false', async () => {
    mockFetch(() => new Response(JSON.stringify({ success: false, error: 'SOURCE_UNVERIFIED' }), { status: 402 }));
    await expect(
      getCredential({ sourcePaymentTx: 'X', destChain: 'base', payTo: REQ.payTo, amount: '2000' }),
    ).rejects.toThrow(/SOURCE_UNVERIFIED/);
  });
});

describe('fetchWithCredential', () => {
  it('submits the X-PAYMENT envelope to the service and returns the response', async () => {
    const spy = mockFetch(
      () => new Response(JSON.stringify({ result: 'trending' }), { status: 200, headers: { 'x-payment-response': 'eyJ0eCI6IjB4YWJjIn0=' } }),
    );
    const r = await fetchWithCredential(SERVICE, 'POST', {}, REQ, CRED);
    expect(r.status).toBe(200);
    expect(r.envelopeVersion).toBe(1);
    expect(r.response).toMatchObject({ result: 'trending' });
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe(SERVICE);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-PAYMENT']).toBeTruthy();
  });

  it('falls back to the V2 envelope when V1 is rejected', async () => {
    let call = 0;
    mockFetch(() => {
      call += 1;
      return call === 1
        ? new Response(JSON.stringify({ error: 'Invalid network' }), { status: 402 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const r = await fetchWithCredential(SERVICE, 'POST', {}, REQ, CRED);
    expect(r.status).toBe(200);
    expect(r.envelopeVersion).toBe(2);
  });

  it('throws if the service rejects every envelope shape', async () => {
    mockFetch(() => new Response('nope', { status: 402 }));
    await expect(fetchWithCredential(SERVICE, 'POST', {}, REQ, CRED)).rejects.toThrow(/rejected the payment credential/);
  });
});
