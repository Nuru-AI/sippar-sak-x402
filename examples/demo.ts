import 'dotenv/config';
import { SolanaAgentKit, KeypairWallet, createVercelAITools } from 'solana-agent-kit';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { SipparX402Plugin } from '../src/index.js';
import { loadDemoKeypair, solanaRpcUrl } from './wallet.js';

// 1. Wallet + agent — the agent signs with its own local Solana wallet
//    (created by `npx sippar-init`); Sippar never holds it.
const rpcUrl = solanaRpcUrl();
const agent = new SolanaAgentKit(
  new KeypairWallet(loadDemoKeypair(), rpcUrl),
  rpcUrl,
  {},
).use(SipparX402Plugin);

// 2. LLM — model-agnostic. The Sippar plugin is just a tool; any Vercel AI SDK
//    provider can drive it. Pick one with AI_PROVIDER (default: anthropic) and set
//    that provider's API key. Override the model id with AI_MODEL.
//    No LLM at all? Run `npx tsx examples/direct.ts` instead.
type ModelArg = Parameters<typeof generateText>[0]['model'];

function resolveModel(): ModelArg {
  const provider = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();
  const requireKey = (envVar: string) => {
    if (!process.env[envVar]) {
      console.error(
        `AI_PROVIDER="${provider}" needs ${envVar} in your .env.\n` +
          'Or test the payment with no LLM at all: npx tsx examples/direct.ts',
      );
      process.exit(1);
    }
  };

  switch (provider) {
    case 'anthropic':
      requireKey('ANTHROPIC_API_KEY');
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
        process.env.AI_MODEL ?? 'claude-sonnet-4-6',
      );
    case 'openai':
      requireKey('OPENAI_API_KEY');
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(
        process.env.AI_MODEL ?? 'gpt-4o',
      );
    case 'google':
      requireKey('GOOGLE_GENERATIVE_AI_API_KEY');
      return createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })(
        process.env.AI_MODEL ?? 'gemini-1.5-pro',
      );
    default:
      console.error(`Unknown AI_PROVIDER "${provider}". Use: anthropic | openai | google.`);
      process.exit(1);
  }
}

const model = resolveModel();

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
  model,
  tools: createVercelAITools(agent, agent.actions),
  maxSteps: 5,
  prompt:
    process.argv.slice(2).join(' ') ||
    `Use the Sippar x402 tool to get the current NVDA stock price from the service at ${DEMO_SERVICE_URL} on destChain "base", then report the price and what it cost.`,
});

console.log('\n=== Agent response ===\n');
console.log(result.text);
