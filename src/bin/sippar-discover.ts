#!/usr/bin/env node
/**
 * `npx sippar-discover [search]`
 *
 * Lists x402 services on the chains Sippar settles to (Base, Arbitrum,
 * Optimism, Polygon, BNB), pulled from the public PayAI x402 registry, so you
 * can find a `serviceUrl` to pay. Read-only — no wallet or access token needed.
 *
 * Optional `search` filters by URL substring. Override the registry with
 * SIPPAR_DISCOVERY_URL.
 */

import type { DestChain } from '../types.js';

const REGISTRY_URL =
  process.env.SIPPAR_DISCOVERY_URL ?? 'https://facilitator.payai.network/discovery/resources';

/** CAIP-2 network id → the destChain name the plugin uses. */
const NETWORK_TO_CHAIN: Record<string, DestChain> = {
  'eip155:8453': 'base',
  'eip155:42161': 'arbitrum',
  'eip155:10': 'optimism',
  'eip155:137': 'polygon',
  'eip155:56': 'bnb',
};

const DEFAULT_LIMIT = 30;

interface Accept {
  network?: string;
  amount?: string;
}
interface RegistryItem {
  resource?: string;
  method?: string;
  accepts?: Accept[];
  inputSchema?: { body?: unknown };
}
interface Row {
  chain: DestChain;
  usdc: number;
  method: string;
  url: string;
  body?: unknown;
}

async function main(): Promise<void> {
  const search = process.argv.slice(2).join(' ').trim().toLowerCase();

  const res = await fetch(REGISTRY_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    console.error(`Discovery registry returned ${res.status}.`);
    process.exit(1);
  }
  const body = (await res.json()) as { items?: RegistryItem[] };

  const rows: Row[] = [];
  for (const item of body.items ?? []) {
    if (!item.resource) continue;
    const accept = (item.accepts ?? []).find((a) => a.network && NETWORK_TO_CHAIN[a.network]);
    if (!accept || !accept.network) continue; // not on a chain Sippar settles to
    if (search && !item.resource.toLowerCase().includes(search)) continue;
    rows.push({
      chain: NETWORK_TO_CHAIN[accept.network],
      usdc: Number(accept.amount ?? '0') / 1_000_000,
      method: (item.method ?? 'GET').toUpperCase(),
      url: item.resource,
      body: item.inputSchema?.body,
    });
  }

  rows.sort((a, b) => a.usdc - b.usdc);

  if (rows.length === 0) {
    console.log(search ? `\nNo services match "${search}".\n` : '\nNo services found.\n');
    return;
  }

  const shown = search ? rows : rows.slice(0, DEFAULT_LIMIT);
  console.log(
    `\n${shown.length}${search ? '' : ` of ${rows.length}`} x402 service(s) Sippar can settle to` +
      `${search ? ` matching "${search}"` : ''} (USDC, via the PayAI registry):\n`,
  );
  for (const r of shown) {
    console.log(
      `  ${r.chain.padEnd(8)} ~$${r.usdc.toFixed(3).padStart(6)}  ${r.method.padEnd(4)}  ${r.url}`,
    );
    if (r.body && typeof r.body === 'object') {
      console.log(`           payload: ${JSON.stringify(r.body)}`);
    }
  }
  if (!search && rows.length > DEFAULT_LIMIT) {
    console.log(
      `\n  …and ${rows.length - DEFAULT_LIMIT} more. Pass a search term to filter, e.g. \`npx sippar-discover price\`.`,
    );
  }
  console.log('\nPay one:');
  console.log('  npx tsx examples/direct.ts <serviceUrl> <chain>');
  console.log('  …or the PAY_X402_VIA_SIPPAR action, with `payload` matching the shape shown.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
