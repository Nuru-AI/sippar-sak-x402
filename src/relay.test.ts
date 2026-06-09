import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probePrice, callWithPayment } from './relay.js';
import type { RelayPaymentRequirements } from './types.js';

const REQUIREMENTS: RelayPaymentRequirements = {
  sourceChain: 'solana',
  destChain: 'base',
  network: 'solana-mainnet',
  chainId: 0,
  asset: {
    symbol: 'USDC',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
  },
  amount: '10300',
  amountFormatted: '0.0103 USDC',
  payTo: '6JBm9umc9KAHYAJdqAVWAqhChGDvYKtwtAe7bpPk29HX',
  fee: { bps: 300, percentage: '3%' },
  description: 'Cross-chain relay to base',
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
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probePrice', () => {
  it('returns paymentRequirements from a 402 response', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({ error: 'Payment Required', paymentRequirements: REQUIREMENTS }),
          {
            status: 402,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    const req = await probePrice('https://svc.base.org/x', 'base');
    expect(req.amount).toBe('10300');
    expect(req.network).toBe('solana-mainnet');
  });

  it('sends the X-Sippar-Access token and solana source body', async () => {
    const spy = mockFetch(
      () => new Response(JSON.stringify({ paymentRequirements: REQUIREMENTS }), { status: 402 }),
    );
    await probePrice('https://svc.base.org/x', 'base');
    const [, init] = spy.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Sippar-Access']).toBeTruthy();
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      sourceChain: 'solana',
      destChain: 'base',
      serviceUrl: 'https://svc.base.org/x',
    });
  });

  it('throws a clear error when the gate rejects the token', async () => {
    mockFetch(() => new Response('forbidden', { status: 403 }));
    await expect(probePrice('https://svc.base.org/x', 'base')).rejects.toThrow(/access token/i);
  });

  it('throws when status is not 402', async () => {
    mockFetch(() => new Response('ok', { status: 200 }));
    await expect(probePrice('https://svc.base.org/x', 'base')).rejects.toThrow(/Expected 402/);
  });

  it('throws when 402 body lacks paymentRequirements', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'x' }), { status: 402 }));
    await expect(probePrice('https://svc.base.org/x', 'base')).rejects.toThrow(
      /paymentRequirements/,
    );
  });
});

describe('callWithPayment', () => {
  it('returns the relay result on success', async () => {
    const spy = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            success: true,
            serviceResponse: { answer: 42 },
            payments: {
              incoming: { chain: 'solana', txHash: 'SIG', amount: 0.0103 },
              outgoing: { chain: 'base', txHash: '0xabc', amount: 0.01 },
              fee: { bps: 300, amount: 0.0003 },
            },
          }),
          { status: 200 },
        ),
    );
    const r = await callWithPayment('https://svc.base.org/x', 'base', 'SIG');
    expect(r.success).toBe(true);
    expect(r.payments?.outgoing?.txHash).toBe('0xabc');
    const [, init] = spy.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-PAYMENT']).toBe('SIG');
  });

  it('throws when the relay returns a non-ok status', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    await expect(callWithPayment('https://svc.base.org/x', 'base', 'SIG')).rejects.toThrow(
      /Relay call failed/,
    );
  });

  it('throws when success is false', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ success: false, error: 'verification failed' }), {
          status: 200,
        }),
    );
    await expect(callWithPayment('https://svc.base.org/x', 'base', 'SIG')).rejects.toThrow(
      /verification failed/,
    );
  });
});
