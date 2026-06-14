/**
 * Direct-mode client for content-private x402 via Sippar (Flow C).
 *
 * The agent fetches the resource ITSELF; Sippar only signs a treasury EIP-3009
 * payment credential. Sippar never sees the serviceUrl, the request body, or the
 * service response — only payment metadata (payTo, amount) and the agent's
 * Solana payment, which it verifies. Content-private; still treasury-custodial
 * (the treasury fronts the destination payment — the agent already paid Sippar
 * on Solana).
 *
 * Flow:
 *   1. probeService()        — agent calls the SERVICE directly, parses its 402
 *   2. (caller pays Sippar's Solana treasury — see signAndSendUSDC in solana.ts)
 *   3. getCredential()       — POST /api/sippar/paysh/pay-from-derived → { signature, authorization }
 *   4. fetchWithCredential() — agent re-calls the SERVICE with X-PAYMENT, returns the response
 *
 * Sippar is contacted only in step 3 (sippar.network, SSRF-pinned via the domain
 * allowlist). Steps 1 and 4 are the agent's own egress to the service URL it
 * chose — standard x402-client behavior — so they skip the Sippar domain pin but
 * still require HTTPS and block private/internal IPs. The caller's payload /
 * method / headers (ServiceRequest) go to the SERVICE here, never to Sippar.
 *
 * Auth: while Sippar is in private beta the credential endpoint sits behind the
 * stealth gate, so the request carries the access token in `X-Sippar-Access`.
 * Set SIPPAR_ACCESS_TOKEN to a valid token (request one from the Sippar team).
 */

import { validateDomain, ALLOWED_DOMAINS } from './security.js';
import type {
  DestChain,
  ServicePaymentRequirements,
  ServiceRequest,
  X402Credential,
  ServiceFetchResult,
} from './types.js';

// Read env at call time (not module load) so callers can set these after import.
function credentialUrl(): string {
  return (
    process.env.SIPPAR_CREDENTIAL_URL ??
    'https://sippar.network/api/sippar/paysh/pay-from-derived'
  );
}

function accessToken(): string {
  return process.env.SIPPAR_ACCESS_TOKEN ?? 'set-SIPPAR_ACCESS_TOKEN';
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable body>';
  }
}

/**
 * Step 1: the AGENT probes the service directly for its 402. Sippar is not
 * involved and never sees the URL or body. Parses the x402 payment option
 * (supports the `accepts[]` body shape regardless of the reported x402Version,
 * plus the PAYMENT-REQUIRED / X-PAYMENT-REQUIRED header fallback).
 */
export async function probeService(
  serviceUrl: string,
  req: ServiceRequest = {},
): Promise<ServicePaymentRequirements> {
  // Agent's own egress: require HTTPS + block private IPs, but NO domain pin.
  const check = validateDomain(serviceUrl, []);
  if (!check.valid) {
    throw new Error(`Refusing to contact service URL: ${check.reason}`);
  }

  const method = req.method ?? 'POST';
  const res = await fetch(serviceUrl, {
    method,
    headers: { 'Content-Type': 'application/json', ...(req.headers ?? {}) },
    body: method === 'POST' ? JSON.stringify(req.payload ?? {}) : undefined,
    redirect: 'error',
  });

  if (res.status !== 402) {
    throw new Error(`Expected 402 from service, got ${res.status}: ${await safeText(res)}`);
  }

  let parsed: any = null;
  const text = await safeText(res);
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  // Body form: { ..., accepts: [ { scheme, network, amount|maxAmountRequired, payTo, asset, ... } ] }
  if (parsed && Array.isArray(parsed.accepts) && parsed.accepts.length > 0) {
    const opt = parsed.accepts[0];
    return {
      payTo: opt.payTo,
      amount: String(opt.amount ?? opt.maxAmountRequired),
      network: opt.network,
      asset: opt.asset,
      accepted: opt,
    };
  }

  // Header form (V1): PAYMENT-REQUIRED / X-PAYMENT-REQUIRED, plain JSON or base64.
  const hdr = res.headers.get('payment-required') || res.headers.get('x-payment-required');
  if (hdr) {
    let h: any = null;
    try {
      h = JSON.parse(hdr);
    } catch {
      try {
        h = JSON.parse(Buffer.from(hdr, 'base64').toString());
      } catch {
        h = null;
      }
    }
    if (h && (h.payTo || h.payto)) {
      return {
        payTo: h.payTo ?? h.payto,
        amount: String(h.maxAmountRequired ?? h.amount),
        network: h.network ?? 'base',
        asset: h.asset,
      };
    }
  }

  throw new Error(`Could not parse service 402 payment requirements: ${text.slice(0, 300)}`);
}

/**
 * Step 3: ask Sippar to sign a treasury EIP-3009 credential for the service's
 * payTo/amount, after the caller has paid Sippar's Solana treasury. Sippar sees
 * only payTo, amount, and the Solana payment — never the serviceUrl or body.
 */
export async function getCredential(params: {
  sourcePaymentTx: string;
  destChain: DestChain;
  payTo: string;
  amount: string;
  asset?: string;
}): Promise<X402Credential> {
  const url = credentialUrl();
  const check = validateDomain(url, ALLOWED_DOMAINS);
  if (!check.valid) {
    throw new Error(`Refusing to contact Sippar credential URL: ${check.reason}`);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sippar-Access': accessToken() },
    body: JSON.stringify({
      sourceChain: 'solana',
      sourcePaymentTx: params.sourcePaymentTx,
      destChain: params.destChain,
      payTo: params.payTo,
      amount: params.amount,
      asset: params.asset,
    }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Sippar rejected the access token (${res.status}). Set SIPPAR_ACCESS_TOKEN to a valid token.`,
    );
  }

  const data = (await res.json().catch(() => null)) as
    | { success?: boolean; credential?: { network: string; payload: { signature: string; authorization: Record<string, unknown> } }; error?: string }
    | null;

  if (!res.ok || !data?.success || !data.credential) {
    throw new Error(
      `Sippar credential request failed (${res.status}): ${data?.error ?? (await safeText(res))}`,
    );
  }

  return {
    signature: data.credential.payload.signature,
    authorization: data.credential.payload.authorization,
    network: data.credential.network,
  };
}

/**
 * Build a base64 x402 X-PAYMENT envelope around Sippar's signed payload. The
 * agent assembles this from its own 402 (Sippar never needs the serviceUrl).
 * V1 first — proven accepted by real Base services (e.g. Heurist); some services
 * want the V2 `accepted`/`resource` shape, tried as a fallback.
 */
function buildEnvelope(
  reqs: ServicePaymentRequirements,
  serviceUrl: string,
  cred: X402Credential,
  version: 1 | 2,
): string {
  const payload = { signature: cred.signature, authorization: cred.authorization };
  let envelope: Record<string, unknown>;
  if (version === 2 && reqs.accepted) {
    const { resource: _r, description: _d, mimeType: _m, ...rest } = reqs.accepted as Record<
      string,
      unknown
    >;
    envelope = {
      x402Version: 2,
      accepted: { ...rest, scheme: 'exact', network: reqs.network },
      resource: {
        url: serviceUrl,
        description: (reqs.accepted as any).description ?? 'API access',
        mimeType: (reqs.accepted as any).mimeType ?? 'application/json',
      },
      extensions: {},
      payload,
    };
  } else {
    envelope = { x402Version: 1, scheme: 'exact', network: reqs.network, payload };
  }
  return Buffer.from(JSON.stringify(envelope)).toString('base64');
}

/**
 * Step 4: the AGENT re-calls the service with the X-PAYMENT envelope and returns
 * the response. Sippar never sees this request or its response. Tries the V1
 * envelope first, then V2 if the service rejects it.
 */
export async function fetchWithCredential(
  serviceUrl: string,
  reqs: ServicePaymentRequirements,
  cred: X402Credential,
  req: ServiceRequest = {},
): Promise<ServiceFetchResult> {
  const check = validateDomain(serviceUrl, []);
  if (!check.valid) {
    throw new Error(`Refusing to contact service URL: ${check.reason}`);
  }

  const method = req.method ?? 'POST';
  const order: Array<1 | 2> = [1, 2];
  let last: { status: number; text: string } = { status: 0, text: '' };

  for (const version of order) {
    if (version === 2 && !reqs.accepted) continue;
    const xPayment = buildEnvelope(reqs, serviceUrl, cred, version);
    const res = await fetch(serviceUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers ?? {}),
        'PAYMENT-SIGNATURE': xPayment,
        'X-PAYMENT': xPayment,
        PAYMENT: xPayment,
      },
      body: method === 'POST' ? JSON.stringify(req.payload ?? {}) : undefined,
      redirect: 'error',
    });

    const text = await safeText(res);
    if (res.ok) {
      let response: unknown = text;
      try {
        response = text ? JSON.parse(text) : { success: true };
      } catch {
        /* keep raw text */
      }
      return {
        status: res.status,
        response,
        settlementReceipt: res.headers.get('x-payment-response'),
        envelopeVersion: version,
      };
    }
    last = { status: res.status, text };
  }

  throw new Error(
    `Service rejected the payment credential (last status ${last.status}): ${last.text.slice(0, 300)}`,
  );
}
