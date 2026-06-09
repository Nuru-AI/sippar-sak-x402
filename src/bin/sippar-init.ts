#!/usr/bin/env node
/**
 * `npx sippar-init`
 *
 * Bootstraps a demo wallet for the Sippar SAK plugin:
 *   1. Generate (or reuse) a Solana keypair at ~/.sippar/demo-wallet.json
 *   2. Hit the Sippar faucet for $0.10 USDC + 0.001 SOL (mainnet, rate-limited)
 *   3. Print the .env lines and the next command to run
 *
 * The faucet is behind the private-beta stealth gate, so set SIPPAR_ACCESS_TOKEN
 * to a valid access token (request one from the Sippar team while in beta).
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const FAUCET_URL =
  process.env.SIPPAR_FAUCET_URL ?? 'https://sippar.network/api/sippar/faucet/solana';

const ACCESS_TOKEN = process.env.SIPPAR_ACCESS_TOKEN ?? 'set-SIPPAR_ACCESS_TOKEN';

const WALLET_PATH = path.join(os.homedir(), '.sippar', 'demo-wallet.json');

async function main(): Promise<void> {
  console.log('\nSippar SAK init\n');

  let kp: Keypair;
  if (fs.existsSync(WALLET_PATH)) {
    const data = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8')) as {
      secretKey: string;
    };
    kp = Keypair.fromSecretKey(bs58.decode(data.secretKey));
    console.log('Loaded existing wallet:', kp.publicKey.toBase58());
  } else {
    kp = Keypair.generate();
    fs.mkdirSync(path.dirname(WALLET_PATH), { recursive: true });
    fs.writeFileSync(
      WALLET_PATH,
      JSON.stringify(
        {
          publicKey: kp.publicKey.toBase58(),
          secretKey: bs58.encode(kp.secretKey),
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log('Generated new wallet:', kp.publicKey.toBase58());
  }

  console.log('\nRequesting demo USDC + SOL from the Sippar faucet...');
  const res = await fetch(FAUCET_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sippar-Access': ACCESS_TOKEN,
    },
    body: JSON.stringify({ address: kp.publicKey.toBase58() }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`\nFaucet request failed: ${res.status}`);
    if (res.status === 429) {
      console.error(
        'Rate limited — this wallet or IP already received funds. ' +
          'Reuse the existing wallet or try again later.',
      );
    } else if (res.status === 401 || res.status === 403) {
      console.error('Access token rejected. Set SIPPAR_ACCESS_TOKEN to a valid token.');
    }
    if (body) console.error(body);
    process.exit(1);
  }

  const result = (await res.json()) as {
    usdc?: number;
    sol?: number;
    usdcSignature?: string;
    solSignature?: string;
  };
  console.log(`Faucet sent: ${result.usdc ?? '?'} USDC + ${result.sol ?? '?'} SOL`);
  if (result.usdcSignature) {
    console.log(`USDC tx: https://solscan.io/tx/${result.usdcSignature}`);
  }
  if (result.solSignature) {
    console.log(`SOL  tx: https://solscan.io/tx/${result.solSignature}`);
  }

  console.log('\nAdd to your .env:');
  console.log(`SOLANA_PRIVATE_KEY=${bs58.encode(kp.secretKey)}`);
  console.log('SOLANA_RPC_URL=https://api.mainnet-beta.solana.com');
  console.log('ANTHROPIC_API_KEY=sk-ant-...');

  console.log('\nTry it:');
  console.log('  npx tsx examples/demo.ts "research the latest Solana DeFi TVL on Base"\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
