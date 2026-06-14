# @sippar/sak-x402

A [SendAI Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) plugin that lets a **Solana agent pay USDC on Solana and consume an x402 service on Base** (or Arbitrum, Optimism, Polygon, BNB) — via Sippar, in **content-private direct mode**.

**No bridge. No wrapped tokens. No custody.** The agent pays one USDC transfer to Sippar on Solana; Sippar verifies it and signs a treasury payment credential (an EIP-3009 authorization) for the destination chain; the **agent fetches the service itself** with that credential. Sippar never sees the request body or the service response — only the payment metadata (payTo, amount). Content-private; still treasury-custodial (the treasury fronts the destination payment).

```
1. Solana agent ──probe──▶ Base x402 service        (agent reads the 402; Sippar not involved)
2. Solana agent ──USDC───▶ Sippar Solana treasury    (pays once)
3. Solana agent ──quote──▶ Sippar                     (gets a treasury-signed EIP-3009 credential)
4. Solana agent ──X-PAYMENT──▶ Base x402 service      (agent fetches; Sippar never sees the response)
```

## Install

```bash
npm install github:Nuru-AI/sippar-sak-x402
```

## Quickstart

First, mint a wallet and pull demo funds (both options need this):

```bash
npx sippar-init          # generate a wallet + pull demo USDC/SOL from the faucet
```

It prints `SOLANA_PRIVATE_KEY=…` and `SOLANA_RPC_URL=…` — add those to a `.env` file, then pick a path:

### Option A — test the payment directly (no LLM, no API key)

The fastest way to confirm the cross-chain flow works. Pays USDC on Solana and returns the Base service response — no model in the loop.

```bash
npx tsx examples/direct.ts                              # default: BlockRun NVDA price on Base
npx tsx examples/direct.ts https://some-service.base.org/x base   # or point it anywhere
```

### Option B — let an LLM drive it (requires a model API key)

```bash
npx tsx examples/demo.ts "research the latest Solana DeFi TVL on Base"
```

The plugin is model-agnostic — `demo.ts` uses the Vercel AI SDK, so any provider works. Pick one with `AI_PROVIDER` and set that provider's key in your `.env`:

```bash
# default
AI_PROVIDER=anthropic   ANTHROPIC_API_KEY=sk-ant-...
# or
AI_PROVIDER=openai      OPENAI_API_KEY=sk-...
# or
AI_PROVIDER=google      GOOGLE_GENERATIVE_AI_API_KEY=...
```

Override the model id with `AI_MODEL` (defaults: `claude-sonnet-4-6`, `gpt-4o`, `gemini-1.5-pro`).

> These are **metered API keys**, billed per token — a Claude.ai (or ChatGPT/Gemini) subscription will **not** work here. If you only want to verify the payment, use Option A — it needs no model key at all.

## Use in an agent

```typescript
import { SolanaAgentKit, KeypairWallet } from 'solana-agent-kit';
import { SipparX402Plugin } from '@sippar/sak-x402';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const kp = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY!));
const rpcUrl = process.env.SOLANA_RPC_URL!;
const agent = new SolanaAgentKit(new KeypairWallet(kp, rpcUrl), rpcUrl, {}).use(SipparX402Plugin);

// The agent now has the PAY_X402_VIA_SIPPAR action available to the LLM.
```

### Direct method call (no LLM)

```typescript
import { payAndCall } from '@sippar/sak-x402';

const result = await payAndCall(agent, 'https://some-service.base.org/x', 'base');
console.log(result.solanaTxUrl); // https://solscan.io/tx/...
console.log(result.destTxUrl);   // https://basescan.org/tx/...
console.log(result.response);    // the service's response
```

## The action

| Field | Value |
|-------|-------|
| name | `PAY_X402_VIA_SIPPAR` |
| input | `{ serviceUrl: string (https), destChain: 'base'｜'arbitrum'｜'optimism'｜'polygon'｜'bnb', maxPriceMicroUsdc?: string }` |
| output | `{ success, solanaTxSignature, solanaTxUrl, destChain, destTxUrl, cost, fee, response }` |

`maxPriceMicroUsdc` is an optional spend cap — the call aborts before paying if the quoted price exceeds it.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `SOLANA_PRIVATE_KEY` | — | base58 secret key for the agent wallet |
| `SOLANA_RPC_URL` | — | Solana RPC endpoint |
| `SIPPAR_CREDENTIAL_URL` | `https://sippar.network/api/sippar/paysh/pay-from-derived` | credential-signing endpoint |
| `SIPPAR_ACCESS_TOKEN` | (required) | private-beta access token — request from the Sippar team |
| `AI_PROVIDER` | `anthropic` | LLM provider for `demo.ts`: `anthropic` \| `openai` \| `google` (Option B only) |
| `AI_MODEL` | per-provider | override the model id (e.g. `gpt-4o`, `gemini-1.5-pro`) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | — | metered key for the chosen `AI_PROVIDER` (Option B only) |

> **Private beta:** Sippar is gated while in private beta. Set `SIPPAR_ACCESS_TOKEN` to a valid access token (request one from the Sippar team) to run the demo end to end. It only unlocks the rate-limited faucet and credential endpoint, both capped server-side.

## Security

- The credential request to Sippar is pinned to `sippar.network` over HTTPS (SSRF / token-leak defense). A tampered `SIPPAR_CREDENTIAL_URL` is rejected. The agent's own fetches to the x402 service require HTTPS and block private/internal IPs, but are not domain-pinned (the agent chooses the service).
- The agent only ever signs a single SPL-USDC transfer to the Sippar treasury — it never signs an arbitrary EVM transaction.
- Set `maxPriceMicroUsdc` to bound spend per call.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # vitest
```

## License

MIT
