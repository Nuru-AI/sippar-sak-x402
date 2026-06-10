/**
 * Shared types for @sippar/sak-x402
 *
 * These mirror the live Sippar cross-chain relay contract
 * (POST https://sippar.network/api/sippar/cross-chain/pay), which is the
 * source of truth for field names and shapes — do not invent fields.
 */

/** Destination chains the relay can settle on (EVM x402 services). */
export const DEST_CHAINS = ['base', 'arbitrum', 'optimism', 'polygon', 'bnb'] as const;

export type DestChain = (typeof DEST_CHAINS)[number];

/**
 * Payment requirements returned in the 402 response body under
 * `paymentRequirements` (also serialized into the `X-PAYMENT-REQUIRED` header).
 */
export interface RelayPaymentRequirements {
  sourceChain: string;
  destChain: string;
  /** e.g. "solana-mainnet" */
  network: string;
  chainId: number;
  asset: {
    symbol: string;
    /** Mint (Solana) or contract address (EVM) */
    address: string;
    decimals: number;
  };
  /** Amount in base units as a string (micro-USDC for USDC). */
  amount: string;
  /** Human-readable amount, e.g. "0.0103 USDC". */
  amountFormatted: string;
  /** Address the source-chain payment must be sent to. */
  payTo: string;
  fee: {
    bps: number;
    percentage: string;
  };
  description: string;
}

/** A single leg of the relay (incoming on source chain, outgoing on dest chain). */
export interface RelayPaymentLeg {
  chain: string;
  txHash: string;
  amount: number;
}

/**
 * Successful relay response body
 * ({ success: true, serviceResponse, payments: { incoming, outgoing, fee } }).
 */
export interface RelayCallResult {
  success: boolean;
  serviceResponse?: unknown;
  payments?: {
    incoming?: RelayPaymentLeg;
    outgoing?: RelayPaymentLeg;
    fee?: { bps: number; amount: number };
  };
  error?: string;
}

/** Normalized result returned by the plugin's `payAndCall` method. */
export interface PayAndCallResult {
  success: boolean;
  solanaTxSignature: string;
  solanaTxUrl: string;
  destChain: DestChain;
  destTxUrl: string | null;
  cost: {
    microUsdc: string;
    usdc: number;
  };
  fee: { bps: number; amount: number } | null;
  response: unknown;
}

/** Optional request to forward to the destination x402 service. */
export interface ServiceRequest {
  /** Request body sent to the service (for x402 services that take input). */
  payload?: unknown;
  /** HTTP method the service expects (defaults to the service's own requirement). */
  method?: 'GET' | 'POST';
  /** Extra headers to forward to the service. */
  headers?: Record<string, string>;
}

/** Options for `payAndCall`: an optional spend cap plus the service request. */
export interface PayOptions extends ServiceRequest {
  /** Spend cap in micro-USDC; aborts before paying if the quote exceeds it. */
  maxPriceMicroUsdc?: bigint;
}
