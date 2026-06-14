/**
 * Shared types for @sippar/sak-x402 (direct mode / Flow C).
 *
 * The plugin pays Sippar's Solana treasury, gets a treasury-signed EIP-3009
 * credential from POST /api/sippar/paysh/pay-from-derived, then fetches the x402
 * service itself. Sippar never sees the request body or the service response.
 */

/** Destination chains Sippar can sign an EIP-3009 USDC credential for. */
export const DEST_CHAINS = ['base', 'arbitrum', 'optimism', 'polygon', 'bnb'] as const;

export type DestChain = (typeof DEST_CHAINS)[number];

/**
 * Payment requirements parsed from the SERVICE's own 402 (the agent probes the
 * service directly — Sippar is not involved at this step).
 */
export interface ServicePaymentRequirements {
  /** Address the destination-chain payment must be sent to (from the 402). */
  payTo: string;
  /** Amount in base units as a string (micro-USDC for USDC). */
  amount: string;
  /** Service network identifier, e.g. "base" or "eip155:8453". */
  network: string;
  /** Asset (USDC contract address on the dest chain), when advertised. */
  asset?: string;
  /** The full accepts[] option, retained so a V2 X-PAYMENT envelope can echo it. */
  accepted?: Record<string, unknown>;
}

/**
 * The treasury-signed EIP-3009 credential returned by Sippar. The agent wraps
 * this in the X-PAYMENT envelope; Sippar never assembled the envelope or saw the
 * serviceUrl.
 */
export interface X402Credential {
  signature: string;
  authorization: Record<string, unknown>;
  /** Destination chain the credential is valid on. */
  network: string;
}

/** Result of the agent's own fetch of the service with the X-PAYMENT envelope. */
export interface ServiceFetchResult {
  status: number;
  response: unknown;
  /** Decoded later by the caller; base64 X-PAYMENT-RESPONSE header if the service set one. */
  settlementReceipt: string | null;
  /** Which envelope shape the service accepted (1 or 2). */
  envelopeVersion: 1 | 2;
}

/** Normalized result returned by the plugin's `payAndCall` method. */
export interface PayAndCallResult {
  success: boolean;
  /** Solana payment to Sippar's treasury (the source payment). */
  solanaTxSignature: string;
  solanaTxUrl: string;
  destChain: DestChain;
  /** Destination settlement tx, if the service's facilitator returned a receipt. */
  destTxUrl: string | null;
  cost: {
    microUsdc: string;
    usdc: number;
  };
  /** Which X-PAYMENT envelope shape the service accepted. */
  envelopeVersion: 1 | 2;
  /** The service response — fetched by the agent; Sippar never saw it. */
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
