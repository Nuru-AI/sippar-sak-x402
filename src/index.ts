/**
 * @sippar/sak-x402 — SendAI Solana Agent Kit plugin
 *
 * Adds one capability to a Solana agent: pay USDC on Solana, consume an x402
 * service that lives on Base / Arbitrum / Optimism / Polygon / BNB, via the
 * Sippar cross-chain relay. No bridge, no wrapped tokens.
 *
 * Flow (per call):
 *   1. probePrice()      — ask the relay what the Solana payment is (402)
 *   2. signAndSendUSDC() — pay the Sippar treasury on Solana
 *   3. callWithPayment() — relay verifies, settles on dest chain, returns response
 */

import type { Plugin, SolanaAgentKit } from 'solana-agent-kit';
import { z } from 'zod';
import { signAndSendUSDC } from './solana.js';
import { probePrice, callWithPayment } from './relay.js';
import { DEST_CHAINS, type DestChain, type PayAndCallResult, type PayOptions } from './types.js';

const inputSchema = z.object({
  serviceUrl: z.string().url().startsWith('https://', 'serviceUrl must use https'),
  destChain: z.enum(DEST_CHAINS),
  /** Optional spend cap in micro-USDC; aborts before paying if exceeded. */
  maxPriceMicroUsdc: z.string().optional(),
  /** Optional request body forwarded to the service (for services that take input). */
  payload: z.unknown().optional(),
  /** HTTP method the service expects (defaults to the service's requirement). */
  method: z.enum(['GET', 'POST']).optional(),
  /** Extra headers forwarded to the service. */
  headers: z.record(z.string()).optional(),
});

/** Block explorer URL for a destination-chain tx hash. */
function destTxUrl(destChain: DestChain, txHash?: string): string | null {
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

/**
 * Core logic shared by the action handler and any direct method callers.
 */
async function payAndCall(
  agent: SolanaAgentKit,
  serviceUrl: string,
  destChain: DestChain,
  opts: PayOptions = {},
): Promise<PayAndCallResult> {
  const { maxPriceMicroUsdc, ...req } = opts;
  const requirements = await probePrice(serviceUrl, destChain, req);

  if (requirements.network !== 'solana-mainnet') {
    throw new Error(
      `Relay offered an unexpected source network: ${requirements.network} (expected solana-mainnet)`,
    );
  }

  const amount = BigInt(requirements.amount);
  if (maxPriceMicroUsdc !== undefined && amount > maxPriceMicroUsdc) {
    throw new Error(`Price ${amount} microUSDC exceeds max ${maxPriceMicroUsdc} microUSDC`);
  }

  const sig = await signAndSendUSDC(agent, amount);
  const result = await callWithPayment(serviceUrl, destChain, sig, req);

  return {
    success: true,
    solanaTxSignature: sig,
    solanaTxUrl: `https://solscan.io/tx/${sig}`,
    destChain,
    destTxUrl: destTxUrl(destChain, result.payments?.outgoing?.txHash),
    cost: {
      microUsdc: amount.toString(),
      usdc: Number(amount) / 1_000_000,
    },
    fee: result.payments?.fee ?? null,
    response: result.serviceResponse,
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
        'call cross-chain service',
        'access EVM service from solana',
        'pay base service with solana usdc',
      ],
      description:
        'Pay USDC on Solana to access an x402 service on Base, Arbitrum, Optimism, ' +
        'Polygon, or BNB via the Sippar cross-chain relay. Pass `payload` to send a ' +
        'request body for services that take input. Returns the service response plus ' +
        'Solana and destination-chain transaction URLs.',
      examples: [
        [
          {
            input: {
              serviceUrl: 'https://example-service.base.org/search',
              destChain: 'base',
              payload: { query: 'latest Solana DeFi TVL' },
            },
            output: { success: true, response: '...' },
            explanation:
              'Agent paid Solana USDC, Sippar settled on Base, and the search service returned results for the query.',
          },
        ],
      ],
      schema: inputSchema,
      handler: async (agent: SolanaAgentKit, input: Record<string, unknown>) => {
        const parsed = inputSchema.parse(input);
        return payAndCall(agent, parsed.serviceUrl, parsed.destChain as DestChain, {
          maxPriceMicroUsdc:
            parsed.maxPriceMicroUsdc !== undefined ? BigInt(parsed.maxPriceMicroUsdc) : undefined,
          payload: parsed.payload,
          method: parsed.method,
          headers: parsed.headers,
        });
      },
    },
  ],
  initialize: () => {},
};

export default SipparX402Plugin;
export { payAndCall };
export * from './types.js';
