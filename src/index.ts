/**
 * @sippar/sak-x402 — SendAI Solana Agent Kit plugin (content-private direct mode)
 *
 * Adds one capability to a Solana agent: pay USDC on Solana, consume an x402
 * service on Base / Arbitrum / Optimism / Polygon / BNB — without Sippar ever
 * seeing the request or the response. No bridge, no wrapped tokens, no custody.
 *
 * Direct mode (Flow C) — Sippar signs a payment credential; the AGENT fetches:
 *   1. probeService()        — the agent asks the SERVICE for its 402 (Sippar not involved)
 *   2. signAndSendUSDC()     — the agent pays the Sippar Solana treasury
 *   3. getCredential()       — Sippar signs a treasury EIP-3009 credential (sees only payTo/amount)
 *   4. fetchWithCredential() — the AGENT calls the service with X-PAYMENT and reads the response
 *
 * Content-private (Sippar never sees the body or response), still treasury-
 * custodial (the treasury fronts the destination payment).
 */

import type { Plugin, SolanaAgentKit } from 'solana-agent-kit';
import { z } from 'zod';
import { signAndSendUSDC } from './solana.js';
import { probeService, getCredential, fetchWithCredential } from './relay.js';
import { DEST_CHAINS, type DestChain, type PayAndCallResult } from './types.js';

const inputSchema = z.object({
  serviceUrl: z.string().url().startsWith('https://', 'serviceUrl must use https'),
  destChain: z.enum(DEST_CHAINS),
  /** Request payload sent to the service (the agent's content — never seen by Sippar). */
  requestBody: z.record(z.unknown()).optional(),
  /** Optional spend cap in micro-USDC; aborts before paying if exceeded. */
  maxPriceMicroUsdc: z.string().optional(),
  /** Sippar margin in basis points added to the Solana payment (default 0). */
  feeBps: z.number().int().min(0).optional(),
});

/** Block explorer URL for a destination-chain tx hash. */
function destTxUrl(destChain: DestChain, txHash?: string | null): string | null {
  if (!txHash) return null;
  const explorers: Record<DestChain, string> = {
    base: 'https://basescan.org/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
    optimism: 'https://optimistic.etherscan.io/tx/',
    polygon: 'https://polygonscan.com/tx/',
    bnb: 'https://bscscan.com/tx/',
  };
  return `${explorers[destChain]}${txHash}`;
}

/** Best-effort extraction of the settlement tx hash from an X-PAYMENT-RESPONSE receipt. */
function settlementTxFromReceipt(receipt: string | null): string | null {
  if (!receipt) return null;
  for (const candidate of [receipt, tryBase64(receipt)]) {
    if (!candidate) continue;
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;
      const tx = obj.transaction ?? obj.txHash ?? obj.txid;
      if (typeof tx === 'string') return tx;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

function tryBase64(s: string): string | null {
  try {
    return Buffer.from(s, 'base64').toString();
  } catch {
    return null;
  }
}

/**
 * Core logic shared by the action handler and any direct method callers.
 */
async function payAndCall(
  agent: SolanaAgentKit,
  serviceUrl: string,
  destChain: DestChain,
  opts: { requestBody?: Record<string, unknown>; maxPriceMicroUsdc?: bigint; feeBps?: number } = {},
): Promise<PayAndCallResult> {
  // 1. Agent probes the SERVICE directly — Sippar never sees this.
  const req = await probeService(serviceUrl, 'POST', opts.requestBody ?? {});

  const amount = BigInt(req.amount);
  if (opts.maxPriceMicroUsdc !== undefined && amount > opts.maxPriceMicroUsdc) {
    throw new Error(`Price ${amount} microUSDC exceeds max ${opts.maxPriceMicroUsdc} microUSDC`);
  }

  // 2. Pay Sippar's Solana treasury (amount + optional fee).
  const feeBps = BigInt(opts.feeBps ?? 0);
  const sourceAmount = amount + (amount * feeBps) / 10_000n;
  const sig = await signAndSendUSDC(agent, sourceAmount);

  // 3. Sippar signs a treasury EIP-3009 credential (sees only payTo/amount + the Solana tx).
  const cred = await getCredential({
    sourcePaymentTx: sig,
    destChain,
    payTo: req.payTo,
    amount: req.amount,
    asset: req.asset,
  });

  // 4. Agent fetches the service itself with the credential — Sippar never sees the response.
  const result = await fetchWithCredential(serviceUrl, 'POST', opts.requestBody ?? {}, req, cred);

  return {
    success: true,
    solanaTxSignature: sig,
    solanaTxUrl: `https://solscan.io/tx/${sig}`,
    destChain,
    destTxUrl: destTxUrl(destChain, settlementTxFromReceipt(result.settlementReceipt)),
    cost: {
      microUsdc: sourceAmount.toString(),
      usdc: Number(sourceAmount) / 1_000_000,
    },
    envelopeVersion: result.envelopeVersion,
    response: result.response,
  };
}

export const SipparX402Plugin: Plugin = {
  name: 'sippar-x402',
  methods: {
    payAndCall,
  },
  actions: [
    {
      name: 'PAY_X402_VIA_SIPPAR',
      similes: [
        'pay for x402 service',
        'call cross-chain service privately',
        'access EVM service from solana',
        'pay base service with solana usdc',
      ],
      description:
        'Pay USDC on Solana to access an x402 service on Base, Arbitrum, Optimism, ' +
        'Polygon, or BNB. Content-private: Sippar signs a payment credential but the ' +
        'agent fetches the service itself, so Sippar never sees the request or response. ' +
        'Returns the service response plus the Solana transaction URL.',
      examples: [
        [
          {
            input: {
              serviceUrl: 'https://mesh.heurist.xyz/x402/agents/TrendingTokenAgent/get_trending_tokens',
              destChain: 'base',
            },
            output: { success: true, response: '...' },
            explanation:
              'Agent paid Solana USDC, Sippar signed a Base credential, the agent called the service directly.',
          },
        ],
      ],
      schema: inputSchema,
      handler: async (agent: SolanaAgentKit, input: Record<string, unknown>) => {
        const parsed = inputSchema.parse(input);
        return payAndCall(agent, parsed.serviceUrl, parsed.destChain as DestChain, {
          requestBody: parsed.requestBody,
          maxPriceMicroUsdc:
            parsed.maxPriceMicroUsdc !== undefined ? BigInt(parsed.maxPriceMicroUsdc) : undefined,
          feeBps: parsed.feeBps,
        });
      },
    },
  ],
  initialize: () => {},
};

export default SipparX402Plugin;
export { payAndCall };
export * from './types.js';
