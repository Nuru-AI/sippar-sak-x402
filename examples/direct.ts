import 'dotenv/config';
import { SolanaAgentKit, KeypairWallet } from 'solana-agent-kit';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { payAndCall, DEST_CHAINS } from '../src/index.js';
import type { DestChain } from '../src/index.js';

// No LLM, no ANTHROPIC_API_KEY. This is the most direct way to test the plugin:
// it pays USDC on Solana and consumes an x402 service via Sippar direct mode —
// Sippar signs a payment credential, the agent fetches the service itself, so
// Sippar never sees the response. Exactly like the agent action does, just
// without the model deciding to call it.
//
//   npx tsx examples/direct.ts [serviceUrl] [destChain]
//
// Defaults to the BlockRun NVDA stock-price service on Base (~$0.001/call).

const kp = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY!));
const rpc = process.env.SOLANA_RPC_URL!;
const agent = new SolanaAgentKit(new KeypairWallet(kp, rpc), rpc, {});

const serviceUrl =
  process.argv[2] ??
  process.env.DEMO_SERVICE_URL ??
  'https://blockrun-web-vbsbhh7lea-uc.a.run.app/api/v1/stocks/us/price/NVDA';
const destChainArg = process.argv[3] ?? 'base';
if (!(DEST_CHAINS as readonly string[]).includes(destChainArg)) {
  console.error(`Unknown destChain "${destChainArg}". Use one of: ${DEST_CHAINS.join(', ')}.`);
  process.exit(1);
}
const destChain = destChainArg as DestChain;

// Optional spend cap: aborts before paying if the quote exceeds $0.05.
const maxPriceMicroUsdc = 50_000n;

console.log(`Paying for ${serviceUrl} (destChain: ${destChain})...\n`);

const result = await payAndCall(agent, serviceUrl, destChain, { maxPriceMicroUsdc });

console.log('=== Result ===');
console.log(`Paid:     ${result.cost.usdc} USDC  (${result.solanaTxUrl})`);
console.log(`Settled:  ${result.destChain}  (${result.destTxUrl ?? 'see service receipt'})`);
console.log(`Envelope: V${result.envelopeVersion}`);
console.log('Response:', JSON.stringify(result.response, null, 2));
