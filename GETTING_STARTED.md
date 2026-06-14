# Getting started with @sippar/sak-x402

Zero to a Solana agent paying a Base x402 service. For the concept and the one-line integration, see the [README](./README.md).

## Prerequisites

- **A Solana wallet** (a keypair) for your agent — it's the agent's own wallet, and it pays the USDC. `npx sippar-init` can mint a throwaway demo wallet (step 1).
- **A Solana RPC URL** — any mainnet RPC. Defaults to `https://api.mainnet-beta.solana.com`, so you can skip it.
- **A Sippar access token** — Sippar is in private beta, so the faucet and credential endpoint are gated. Request one at **elad@sippar.network** and set it as `SIPPAR_ACCESS_TOKEN`.

No Base wallet, no bridging, no wrapped tokens — the agent only ever holds and signs on Solana.

## Install

```bash
npm install github:Nuru-AI/sippar-sak-x402
```

## 1. Mint a demo wallet + pull funds

```bash
npx sippar-init
```

Creates a wallet at `~/.sippar/demo-wallet.json` and funds it from the Sippar faucet (mainnet, rate-limited: 0.1 USDC + 0.001 SOL). The examples load that wallet automatically — **no private key to copy into your shell or `.env`**.

## 2. Try it live (no LLM, no API key)

```bash
npx tsx examples/direct.ts        # pays a live NVDA price feed on Base (~$0.001)
```

```text
=== Result ===
Paid:     0.001031 USDC  (https://solscan.io/tx/51sVLwhn…)
Settled:  base  (https://basescan.org/tx/0xd8ecaa73…)
Response: { "symbol": "NVDA", "price": 205.53, "source": "pyth" }
```

## 3. A complete agent (from scratch)

```typescript
import { SolanaAgentKit, KeypairWallet } from 'solana-agent-kit';
import { SipparX402Plugin } from '@sippar/sak-x402';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const kp = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY!)); // your agent's wallet
const rpcUrl = process.env.SOLANA_RPC_URL!;                                     // any Solana RPC
const agent = new SolanaAgentKit(new KeypairWallet(kp, rpcUrl), rpcUrl, {}).use(SipparX402Plugin);

// agent now has the PAY_X402_VIA_SIPPAR action.
```

## 4. Let an LLM drive it

```bash
npx tsx examples/demo.ts "get the NVDA price on Base"
```

`demo.ts` is model-agnostic — pick a provider with `AI_PROVIDER` and set that provider's key in your `.env`:

```bash
AI_PROVIDER=anthropic   ANTHROPIC_API_KEY=sk-ant-...
AI_PROVIDER=openai      OPENAI_API_KEY=sk-...
AI_PROVIDER=google      GOOGLE_GENERATIVE_AI_API_KEY=...
```

These are **metered API keys**, billed per token — a Claude.ai / ChatGPT / Gemini subscription will **not** work. If you only want to verify the payment, use step 2 (no model key needed).

## Sending a request (query) to a service

Many x402 services take input (a search query, a prompt). Pass it as `payload` — your agent sends it to the service directly (Sippar never sees it):

```typescript
const result = await payAndCall(agent, 'https://some-service.base.org/search', 'base', {
  payload: { query: 'latest Solana DeFi TVL' },   // the request body sent to the service
  method: 'POST',                                  // optional — defaults to the service's requirement
  headers: { 'X-Custom': 'value' },                // optional — extra headers forwarded to the service
});
```

For the LLM-driven action, the model fills `payload` from the user's request. Simple GET services (like a price feed) need no payload.

## Finding services to pay for

Run the built-in discovery command — it lists x402 services on the chains Sippar settles to, with prices and payload shapes. No wallet or token needed:

```bash
npx sippar-discover            # all services
npx sippar-discover price      # filter by URL substring
```

```text
base     ~$ 0.050  GET   https://x402.cambrian.network/x402/api/v1/evm/price-current
base     ~$ 0.020  POST  https://parsedoc.wrapper-agency.com/api/v1/parse
         payload: {"image_url":"https://example.com/receipt.jpg"}
```

Copy a `serviceUrl` + chain into `examples/direct.ts` or the `PAY_X402_VIA_SIPPAR` action (with `payload` matching the shape shown). It reads the public **PayAI** registry by default (`SIPPAR_DISCOVERY_URL` to override); **Coinbase Bazaar** (`https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`) is another source (needs a CDP key).

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `SOLANA_PRIVATE_KEY` | keystore | base58 key for the agent wallet (examples fall back to the `sippar-init` keystore) |
| `SOLANA_RPC_URL` | mainnet-beta | Solana RPC for broadcasting the agent's own payment |
| `SIPPAR_CREDENTIAL_URL` | `https://sippar.network/api/sippar/paysh/pay-from-derived` | credential-signing endpoint |
| `SIPPAR_ACCESS_TOKEN` | (required) | private-beta access token — request at elad@sippar.network |
| `AI_PROVIDER` | `anthropic` | LLM provider for `demo.ts`: `anthropic` \| `openai` \| `google` |
| `AI_MODEL` | per-provider | override the model id (e.g. `gpt-4o`, `gemini-1.5-pro`) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | — | metered key for the chosen `AI_PROVIDER` |

## The action

| Field | Value |
|-------|-------|
| name | `PAY_X402_VIA_SIPPAR` |
| input | `{ serviceUrl, destChain, payload?, method?, headers?, maxPriceMicroUsdc? }` |
| output | `{ success, solanaTxSignature, solanaTxUrl, destChain, destTxUrl, cost, envelopeVersion, response }` |

- **`serviceUrl`** — an https x402 endpoint (find one with `npx sippar-discover`).
- **`destChain`** — `base`, `arbitrum`, `optimism`, `polygon`, or `bnb`.
- **`payload`** — request body for services that take input (see [Sending a request](#sending-a-request-query-to-a-service)).
- **`maxPriceMicroUsdc`** — optional spend cap; aborts before paying if the quote exceeds it.

## Other ways to integrate

The plugin is a thin client over Sippar's credential endpoint, so any agent — not just SAK — can reach it:

- **HTTP** — the agent probes the service for its 402, pays Sippar's Solana treasury, then `POST https://sippar.network/api/sippar/paysh/pay-from-derived` (with the Solana tx + the service's payTo/amount) returns a treasury-signed EIP-3009 credential; the agent submits it to the service itself in an `X-PAYMENT` header.
- **MCP** — Sippar exposes payment tools at `https://sippar.network/mcp/` for MCP-native agents.

Learn more at [sippar.network](https://sippar.network).

## Security

- The credential request to Sippar is pinned to `sippar.network` over HTTPS (SSRF / token-leak defense). A tampered `SIPPAR_CREDENTIAL_URL` is rejected. The agent's own fetches to the x402 service require HTTPS and block private/internal IPs, but are not domain-pinned (the agent chooses the service).
- The agent only ever signs a single SPL-USDC transfer to the Sippar treasury — never an arbitrary EVM transaction.
- The agent's Solana wallet is its own and stays local (`~/.sippar/demo-wallet.json` for the demo, or your own key) — Sippar never receives or holds it; it only verifies the resulting on-chain transaction.
- Set `maxPriceMicroUsdc` to bound spend per call.
- **Content-private:** Sippar signs the payment credential; your agent fetches the service directly, so your request and the result never transit Sippar — it sees only the payment metadata (payTo, amount) and your Solana payment. Still treasury-custodial: the treasury fronts the destination payment (your agent already paid Sippar on Solana).

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # vitest
```
