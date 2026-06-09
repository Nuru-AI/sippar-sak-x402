/**
 * Solana USDC transfer helper.
 *
 * Sends micro-USDC from the agent's wallet to the Sippar Solana treasury,
 * which is the payTo the relay returns for Solana-source payments. The returned
 * signature is what we hand back to the relay in the X-PAYMENT header.
 */

import type { SolanaAgentKit } from 'solana-agent-kit';
import {
  Transaction,
  PublicKey,
  type Connection,
  type VersionedTransaction,
} from '@solana/web3.js';
import { createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';

/** Sippar Solana treasury (threshold-derived from the treasury principal). */
export const SIPPAR_TREASURY = new PublicKey('6JBm9umc9KAHYAJdqAVWAqhChGDvYKtwtAe7bpPk29HX');

/** USDC mint on Solana mainnet. */
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/**
 * Resolve the agent's signing public key across the SAK wallet variants.
 */
function walletPubkey(agent: SolanaAgentKit): PublicKey {
  const wallet = (agent as unknown as { wallet?: { publicKey?: PublicKey } }).wallet;
  const pk = wallet?.publicKey ?? (agent as unknown as { publicKey?: PublicKey }).publicKey;
  if (!pk) {
    throw new Error('Could not resolve agent wallet public key');
  }
  return pk;
}

function getConnection(agent: SolanaAgentKit): Connection {
  const conn = (agent as unknown as { connection?: Connection }).connection;
  if (!conn) {
    throw new Error('Agent has no Solana connection');
  }
  return conn;
}

/**
 * Build, sign, and send a USDC transfer to the Sippar treasury.
 * Returns the confirmed transaction signature.
 */
export async function signAndSendUSDC(
  agent: SolanaAgentKit,
  amountMicroUsdc: bigint,
): Promise<string> {
  if (amountMicroUsdc <= 0n) {
    throw new Error('USDC amount must be positive');
  }

  const conn = getConnection(agent);
  const payer = walletPubkey(agent);

  const fromAta = await getAssociatedTokenAddress(USDC_MINT, payer);
  const toAta = await getAssociatedTokenAddress(USDC_MINT, SIPPAR_TREASURY);

  const tx = new Transaction().add(
    createTransferInstruction(fromAta, toAta, payer, amountMicroUsdc),
  );

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;

  const wallet = (
    agent as unknown as {
      wallet: { signTransaction: (t: Transaction) => Promise<Transaction | VersionedTransaction> };
    }
  ).wallet;
  const signed = await wallet.signTransaction(tx);

  const sig = await conn.sendRawTransaction(signed.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}
