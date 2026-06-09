import 'dotenv/config';
import { SolanaAgentKit, KeypairWallet, createVercelAITools } from 'solana-agent-kit';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { SipparX402Plugin } from '../src/index.js';

// 1. Wallet + agent
const kp = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY!));
const agent = new SolanaAgentKit(
  new KeypairWallet(kp, new Connection(process.env.SOLANA_RPC_URL!)),
  process.env.SOLANA_RPC_URL!,
  {},
).use(SipparX402Plugin);

// 2. LLM
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// 3. Prompt -> the agent decides to use PAY_X402_VIA_SIPPAR, pays on Solana,
//    Sippar settles on Base, the service response comes back.
//
// Default demo service: BlockRun NVDA stock price (an x402 service on Base,
// ~$0.001/call, Pyth-sourced). Override with DEMO_SERVICE_URL, or pass a custom
// prompt as CLI args.
const DEMO_SERVICE_URL =
  process.env.DEMO_SERVICE_URL ??
  'https://blockrun-web-vbsbhh7lea-uc.a.run.app/api/v1/stocks/us/price/NVDA';

const result = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  tools: createVercelAITools(agent, agent.actions),
  maxSteps: 5,
  prompt:
    process.argv.slice(2).join(' ') ||
    `Use the Sippar x402 tool to get the current NVDA stock price from the service at ${DEMO_SERVICE_URL} on destChain "base", then report the price and what it cost.`,
});

console.log('\n=== Agent response ===\n');
console.log(result.text);
