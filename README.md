# @sippar/sak-x402

A [SendAI Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) plugin that lets a **Solana agent pay USDC on Solana and consume an x402 service on Base** (or Arbitrum, Optimism, Polygon, BNB) — via the Sippar cross-chain relay.

**No bridge. No wrapped tokens. No custody.** The agent signs one USDC transfer on Solana; Sippar verifies it, settles the service payment on the destination chain with its own treasury, and returns the service response plus both transaction links.

```
Solana agent ──USDC──▶ Sippar relay ──USDC──▶ Base x402 service
   (signs once)         (verifies + settles)      (returns data)
```

## Install

```bash
npm install github:Nuru-AI/sippar-sak-x402
```

> **Windows + AVG/Avast antivirus?** If `npm install` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, your AV's HTTPS scanning is intercepting TLS and Node doesn't trust its cert. Point Node at the AV root cert — `export NODE_EXTRA_CA_CERTS=/path/to/av-root.pem` — or disable HTTPS scanning for the install.

## Quickstart

```bash
npx sippar-init          # generate a wallet + pull demo USDC/SOL from the faucet
npx tsx examples/demo.ts "research the latest Solana DeFi TVL on Base"
```

## Use in an agent

```typescript
import { SolanaAgentKit, KeypairWallet } from 'solana-agent-kit';
import { SipparX402Plugin } from '@sippar/sak-x402';
import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

const kp = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY!));
const agent = new SolanaAgentKit(
  new KeypairWallet(kp, new Connection(process.env.SOLANA_RPC_URL!)),
  process.env.SOLANA_RPC_URL!,
  {},
).use(SipparX402Plugin);

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
| `SIPPAR_RELAY_URL` | `https://sippar.network/api/sippar/cross-chain/pay` | relay endpoint |
| `SIPPAR_ACCESS_TOKEN` | (required) | private-beta access token — request from the Sippar team |

> **Private beta:** Sippar is gated while in private beta. Set `SIPPAR_ACCESS_TOKEN` to a valid access token (request one from the Sippar team) to run the demo end to end. It only unlocks the rate-limited faucet and relay, both capped server-side.

## Security

- All relay requests are pinned to `sippar.network` over HTTPS (SSRF / token-leak defense). A tampered `SIPPAR_RELAY_URL` is rejected.
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
