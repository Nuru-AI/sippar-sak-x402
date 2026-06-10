/**
 * HTTP client for the Sippar cross-chain relay.
 *
 * Two-step x402 flow against POST /api/sippar/cross-chain/pay:
 *   1. probePrice()      -> POST without X-PAYMENT, expect 402 + paymentRequirements
 *   2. callWithPayment() -> POST with X-PAYMENT: <solana tx sig>, expect 200 + serviceResponse
 *
 * Contract source of truth: the live POST /api/sippar/cross-chain/pay endpoint.
 *
 * Auth: while Sippar is in private beta the relay sits behind the stealth gate,
 * so every request carries the revocable demo access token in `X-Sippar-Access`.
 * Override with SIPPAR_ACCESS_TOKEN once the gate opens / the token is rotated.
 */

import { validateDomain } from './security.js';
import type {
  DestChain,
  RelayCallResult,
  RelayPaymentRequirements,
  ServiceRequest,
} from './types.js';

const SIPPAR_RELAY_URL =
  process.env.SIPPAR_RELAY_URL ?? 'https://sippar.network/api/sippar/cross-chain/pay';

// Private beta: the relay sits behind the stealth gate. Set SIPPAR_ACCESS_TOKEN
// to a valid access token (request one from the Sippar team while in beta).
const ACCESS_TOKEN = process.env.SIPPAR_ACCESS_TOKEN ?? 'set-SIPPAR_ACCESS_TOKEN';

function relayHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Sippar-Access': ACCESS_TOKEN,
    ...extra,
  };
}

function relayBody(serviceUrl: string, destChain: DestChain, req?: ServiceRequest): string {
  return JSON.stringify({
    sourceChain: 'solana',
    destChain,
    serviceUrl,
    ...(req?.payload !== undefined ? { servicePayload: req.payload } : {}),
    ...(req?.method ? { serviceMethod: req.method } : {}),
    ...(req?.headers ? { serviceHeaders: req.headers } : {}),
  });
}

/**
 * Build and send a URL-safety-checked POST to the relay. Centralizes the
 * domain allowlist / SSRF guard so every relay request goes through it.
 */
async function postToRelay(
  serviceUrl: string,
  destChain: DestChain,
  req?: ServiceRequest,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const check = validateDomain(SIPPAR_RELAY_URL);
  if (!check.valid) {
    throw new Error(`Refusing to contact relay URL: ${check.reason}`);
  }
  return fetch(SIPPAR_RELAY_URL, {
    method: 'POST',
    headers: relayHeaders(extraHeaders),
    body: relayBody(serviceUrl, destChain, req),
  });
}

/**
 * Step 1: ask the relay what the Solana-side payment is. Returns the
 * paymentRequirements from the 402 body.
 */
export async function probePrice(
  serviceUrl: string,
  destChain: DestChain,
  req?: ServiceRequest,
): Promise<RelayPaymentRequirements> {
  const res = await postToRelay(serviceUrl, destChain, req);

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Sippar relay rejected the access token (${res.status}). ` +
        'Set SIPPAR_ACCESS_TOKEN to a valid token.',
    );
  }
  if (res.status !== 402) {
    throw new Error(`Expected 402 from Sippar relay, got ${res.status}: ${await safeText(res)}`);
  }

  const body = (await res.json()) as { paymentRequirements?: RelayPaymentRequirements };
  if (!body.paymentRequirements) {
    throw new Error('402 response did not include paymentRequirements');
  }
  return body.paymentRequirements;
}

/**
 * Step 2: re-POST with the Solana transaction signature in X-PAYMENT. The relay
 * verifies the incoming payment, calls the external service, settles on the
 * destination chain, and returns the service response + payment receipts.
 */
export async function callWithPayment(
  serviceUrl: string,
  destChain: DestChain,
  paymentSig: string,
  req?: ServiceRequest,
): Promise<RelayCallResult> {
  const res = await postToRelay(serviceUrl, destChain, req, { 'X-PAYMENT': paymentSig });

  if (!res.ok) {
    throw new Error(`Relay call failed: ${res.status} ${await safeText(res)}`);
  }

  const body = (await res.json()) as RelayCallResult;
  if (!body.success) {
    throw new Error(`Relay reported failure: ${body.error ?? 'unknown error'}`);
  }
  return body;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable body>';
  }
}
