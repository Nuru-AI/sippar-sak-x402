import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Load the demo wallet.
 *
 * Prefers the keystore that `npx sippar-init` writes (~/.sippar/demo-wallet.json)
 * so you never copy a raw private key into your shell or `.env`. Set
 * SOLANA_PRIVATE_KEY to override with your own base58 key.
 *
 * This is the agent's own Solana wallet — it signs its own USDC payment locally.
 * Sippar never sees or holds the key; it only verifies the resulting on-chain tx.
 */
export function loadDemoKeypair(): Keypair {
  const fromEnv = process.env.SOLANA_PRIVATE_KEY;
  if (fromEnv) return Keypair.fromSecretKey(bs58.decode(fromEnv));

  const walletPath = path.join(os.homedir(), '.sippar', 'demo-wallet.json');
  if (!fs.existsSync(walletPath)) {
    throw new Error(
      `No demo wallet at ${walletPath}. Run \`npx sippar-init\` first, ` +
        'or set SOLANA_PRIVATE_KEY to your own base58 key.',
    );
  }
  const { secretKey } = JSON.parse(fs.readFileSync(walletPath, 'utf8')) as { secretKey: string };
  return Keypair.fromSecretKey(bs58.decode(secretKey));
}

/** Solana RPC used to build/broadcast the agent's own payment. Defaults to public mainnet-beta. */
export function solanaRpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
}
