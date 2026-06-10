# Getting started with @sippar/sak-x402

Zero to a Solana agent paying a Base x402 service. For the concept and the one-line integration, see the [README](./README.md).

## Prerequisites

- **A Solana wallet** (a keypair) for your agent — it's the agent's own wallet, and it pays the USDC. `npx sippar-init` can mint a throwaway demo wallet (step 1).
- **A Solana RPC URL** — any mainnet RPC. Defaults to `https://api.mainnet-beta.solana.com`, so you can skip it.
- **A Sippar access token** — Sippar is in private beta, so the faucet and relay are gated. Request one at **elad@sippar.network** and set it as `SIPPAR_ACCESS_TOKEN`.

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

Many x402 services take input (a search query, a prompt). Pass it as `payload` — the relay forwards it to the service after payment:

```typescript
const result = await payAndCall(agent, 'https://some-service.base.org/search', 'base', {
  payload: { query: 'latest Solana DeFi TVL' },   // the request body sent to the service
  method: 'POST',                                  // optional — defaults to the service's requirement
  headers: { 'X-Custom': 'value' },                // optional — extra headers forwarded to the service
});
```

For the LLM-driven action, the model fills `payload` from the user's request. Simple GET services (like a price feed) need no payload.

## Finding services to pay for

`serviceUrl` can be any standard x402 endpoint on Base, Arbitrum, Optimism, Polygon, or BNB. To discover services:

- **Coinbase Bazaar** (Base / Coinbase ecosystem) — `https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`
- **PayAI registry** — `https://facilitator.payai.network/discovery/resources`

Point `serviceUrl` at any x402 endpoint from those.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `SOLANA_PRIVATE_KEY` | keystore | base58 key for the agent wallet (examples fall back to the `sippar-init` keystore) |
| `SOLANA_RPC_URL` | mainnet-beta | Solana RPC for broadcasting the agent's own payment |
| `SIPPAR_RELAY_URL` | `https://sippar.network/api/sippar/cross-chain/pay` | relay endpoint |
| `SIPPAR_ACCESS_TOKEN` | (required) | private-beta access token — request at elad@sippar.network |
| `AI_PROVIDER` | `anthropic` | LLM provider for `demo.ts`: `anthropic` \| `openai` \| `google` |
| `AI_MODEL` | per-provider | override the model id (e.g. `gpt-4o`, `gemini-1.5-pro`) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | — | metered key for the chosen `AI_PROVIDER` |

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # vitest
```
