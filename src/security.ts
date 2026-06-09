/**
 * Security validations for @sippar/sak-x402
 *
 * The plugin only ever talks to ONE endpoint — the Sippar cross-chain relay on
 * sippar.network. We still validate the relay URL on every call so a tampered
 * SIPPAR_RELAY_URL env var (prompt-injection / supply-chain) cannot redirect
 * payments or leak the access token to an attacker-controlled host.
 *
 * Ported from packages/plugin-x402-solana/src/security.ts, allowlist narrowed
 * to sippar.network.
 */

/** Domains the plugin is allowed to contact. */
export const ALLOWED_DOMAINS = ['sippar.network'];

/** Private / internal IP ranges to block (SSRF defense). */
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./, // Link-local
  /^fc00:/i, // IPv6 private
  /^fd[0-9a-f]{2}:/i, // IPv6 ULA
  /^fe80:/i, // IPv6 link-local
  /^::1$/, // IPv6 loopback
  /^::ffff:(127|10|172\.(1[6-9]|2[0-9]|3[0-1])|192\.168)\./i, // IPv6-mapped IPv4 dotted
];

/**
 * Check if an IPv6-mapped IPv4 address (hex format) is a private IP.
 * Format: ::ffff:XXYY:ZZWW where XX.YY.ZZ.WW is the IPv4 address.
 */
function isPrivateIPv6Mapped(hostname: string): boolean {
  const match = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!match) return false;

  const high = parseInt(match[1], 16);
  const low = parseInt(match[2], 16);
  const octets = [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
  const ipv4 = octets.join('.');

  return (
    /^127\./.test(ipv4) ||
    /^10\./.test(ipv4) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ipv4) ||
    /^192\.168\./.test(ipv4) ||
    /^0\./.test(ipv4) ||
    /^169\.254\./.test(ipv4)
  );
}

/**
 * Validate a URL against the allowed domains and SSRF rules.
 * Requires HTTPS, blocks private IPs, enforces the domain allowlist.
 */
export function validateDomain(
  url: string,
  allowedDomains: string[] = ALLOWED_DOMAINS,
): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTPS URLs are allowed' };
  }

  let hostname = parsed.hostname;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: 'Private/internal IP addresses are blocked' };
    }
  }

  if (isPrivateIPv6Mapped(hostname)) {
    return { valid: false, reason: 'Private/internal IP addresses are blocked' };
  }

  if (allowedDomains.length > 0) {
    const isAllowed = allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    if (!isAllowed) {
      return { valid: false, reason: `Domain ${hostname} not in allowed list` };
    }
  }

  return { valid: true };
}

/**
 * Build a response-size guard. The relay response is small JSON; reject
 * anything implausibly large (decompression-bomb / memory-exhaustion defense).
 */
export function createResponseValidator(
  maxSize: number,
): (response: Response) => { valid: boolean; reason?: string } {
  return (response: Response) => {
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!isNaN(size) && size > maxSize) {
        return {
          valid: false,
          reason: `Response size ${size} exceeds maximum ${maxSize}`,
        };
      }
    }
    return { valid: true };
  };
}
