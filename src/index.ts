/**
 * @sippar/sak-x402 — SendAI Solana Agent Kit plugin
 *
 * Adds one capability to a Solana agent: pay USDC on Solana, consume an x402
 * service that lives on Base / Arbitrum / Optimism / Polygon / BNB, via the
 * Sippar cross-chain relay. No bridge, no wrapped tokens, no custody.
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
import { DEST_CHAINS, type DestChain, type PayAndCallResult } from './types.js';

const inputSchema = z.object({
  serviceUrl: z.string().url().startsWith('https://', 'serviceUrl must use https'),
  destChain: z.enum(DEST_CHAINS),
  /** Optional spend cap in micro-USDC; aborts before paying if exceeded. */
  maxPriceMicroUsdc: z.string().optional(),
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
  maxPriceMicroUsdc?: bigint,
): Promise<PayAndCallResult> {
  const requirements = await probePrice(serviceUrl, destChain);

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
  const result = await callWithPayment(serviceUrl, destChain, sig);

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
        'Polygon, or BNB via the Sippar cross-chain relay. Returns the service ' +
        'response plus Solana and destination-chain transaction URLs.',
      examples: [
        [
          {
            input: {
              serviceUrl: 'https://example-service.base.org/search',
              destChain: 'base',
            },
            output: { success: true, response: '...' },
            explanation:
              'Agent paid Solana USDC, Sippar settled on Base, the service returned results.',
          },
        ],
      ],
      schema: inputSchema,
      handler: async (agent: SolanaAgentKit, input: Record<string, unknown>) => {
        const parsed = inputSchema.parse(input);
        const max =
          parsed.maxPriceMicroUsdc !== undefined ? BigInt(parsed.maxPriceMicroUsdc) : undefined;
        return payAndCall(agent, parsed.serviceUrl, parsed.destChain as DestChain, max);
      },
    },
  ],
  initialize: () => {},
};

export default SipparX402Plugin;
export { payAndCall };
export * from './types.js';
