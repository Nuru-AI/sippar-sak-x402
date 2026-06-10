# @sippar/sak-x402

**Sippar is the cross-chain payment highway for AI agents.** Your agent pays from the chain it already holds funds on; Sippar settles the service-side payment on another chain and hands back the result — no bridge, no wrapped tokens, no seed phrase.

`@sippar/sak-x402` brings that to the [SendAI Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit): your **Solana agent pays USDC on Solana and consumes an x402 service on Base** (or Arbitrum, Optimism, Polygon, BNB) — in a single action. It signs one USDC transfer; Sippar verifies it, pays the service from its own treasury on the destination chain, and returns the response plus both transaction links.

```
Solana agent ──USDC──▶ Sippar relay ──USDC──▶ Base x402 service
   (signs once)         (verifies + settles)      (returns data)
```

## Demo

![A Solana agent pays USDC on Solana to consume a Base x402 service via the Sippar relay — returning the live result with real Solana-payment and Base-settlement transaction links.](./assets/sippar-demo.gif)

One call: the agent pays USDC on Solana for a Base x402 service (live NVDA price, ~$0.001), Sippar settles it cross-chain, and the data comes back with real Solscan + Basescan tx links.

## Add it to your agent

```bash
npm install github:Nuru-AI/sippar-sak-x402
```

If you already have a [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) agent, it's **one line**:

```typescript
import { SipparX402Plugin } from '@sippar/sak-x402';

agent.use(SipparX402Plugin);
```

Your agent now has the **`PAY_X402_VIA_SIPPAR`** action: when the LLM needs a paid Base service, it pays USDC on Solana and **the service's response comes straight back** — the relay fetches it for you, so there's no second request and no web/HTTP tool to enable.

Or call it in code, no LLM:

```typescript
import { payAndCall } from '@sippar/sak-x402';

const result = await payAndCall(agent, 'https://some-service.base.org/search', 'base', {
  payload: { query: 'latest Solana DeFi TVL' }, // for services that take input; omit for GET
});
result.response;     // the service's data (returned to you by the relay)
result.solanaTxUrl;  // your Solana payment, on Solscan
result.destTxUrl;    // Sippar's Base settlement, on Basescan
```

> **New here?** [**GETTING_STARTED.md**](./GETTING_STARTED.md) walks you through install, prerequisites, the demo wallet + faucet, a full runnable example, sending a request/query, finding services, and configuration.

## The action

| Field | Value |
|-------|-------|
| name | `PAY_X402_VIA_SIPPAR` |
| input | `{ serviceUrl: string (https), destChain: 'base'｜'arbitrum'｜'optimism'｜'polygon'｜'bnb', payload?: any, method?: 'GET'｜'POST', headers?: object, maxPriceMicroUsdc?: string }` |
| output | `{ success, solanaTxSignature, solanaTxUrl, destChain, destTxUrl, cost, fee, response }` |

- **`payload`** — the request body for services that take input (search, LLM, etc.); omit for simple GET services. The relay forwards it to the service after payment. See [GETTING_STARTED.md](./GETTING_STARTED.md#sending-a-request-query-to-a-service).
- **`maxPriceMicroUsdc`** — optional spend cap; the call aborts before paying if the quote exceeds it.

## Beyond Solana Agent Kit

The plugin is a thin client over Sippar's cross-chain relay, so any agent — not just SAK — can reach it:

- **HTTP** — `POST https://sippar.network/api/sippar/cross-chain/pay` returns a 402 with payment requirements, then settles on retry with an `X-PAYMENT` header.
- **MCP** — Sippar exposes payment tools at `https://sippar.network/mcp/` for MCP-native agents.

Learn more at [sippar.network](https://sippar.network).

## Use with your AI coding assistant

Building on Sippar with Claude, Cursor, or another AI assistant? Point it at this repo as an MCP server so it reads the real docs and code while you integrate — no hallucinated APIs:

```
github.com/Nuru-AI/sippar-sak-x402  →  https://gitmcp.io/Nuru-AI/sippar-sak-x402
```

Add `https://gitmcp.io/Nuru-AI/sippar-sak-x402` as an MCP server in your assistant.

## Security

- All relay requests are pinned to `sippar.network` over HTTPS (SSRF / token-leak defense). A tampered `SIPPAR_RELAY_URL` is rejected.
- The agent only ever signs a single SPL-USDC transfer to the Sippar treasury — never an arbitrary EVM transaction.
- The agent's Solana wallet is its own and stays local (`~/.sippar/demo-wallet.json` for the demo, or your own key) — Sippar never receives or holds it; it only verifies the resulting on-chain transaction.
- Set `maxPriceMicroUsdc` to bound spend per call.
- **Content privacy (in development):** today the relay calls the service and returns the response, so your request and the result transit Sippar. A content-private mode — where Sippar signs the payment credential and your agent fetches the service directly, so Sippar handles only the payment, never your request or its response — is in active development.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # vitest
```

See [GETTING_STARTED.md](./GETTING_STARTED.md) for setup, configuration, and running the examples.

## License

MIT
