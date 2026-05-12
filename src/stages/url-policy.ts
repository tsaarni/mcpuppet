// URL safety policy: blocks private/loopback/internal IP ranges and non-HTTP(S) schemes to prevent SSRF attacks.
import type { Stage } from '../types.ts';

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::', '::1']);
const PRIVATE_RANGES = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
];
const BLOCKED_IPS = new Set(['169.254.169.254']);
// IPv6 prefixes that resolve to private/internal space.
// '::ffff:' covers IPv4-mapped (RFC 4291), 'fe80:' covers link-local, 'fc'/'fd' cover unique-local (RFC 4193).
const BLOCKED_IPV6_PREFIXES = ['::ffff:', '::ffff:0:', 'fe80:', 'fc', 'fd'];

function isBlockedIPv4(ip: string): boolean {
  return BLOCKED_HOSTS.has(ip) || BLOCKED_IPS.has(ip) || PRIVATE_RANGES.some((r) => r.test(ip));
}

/**
 * If `host` is an IPv4-compatible IPv6 address (first 96 bits zero, last 32 bits IPv4),
 * return the embedded IPv4 as a dotted-decimal string. Otherwise return null.
 *
 * Handles:
 *   ::a.b.c.d            – compressed dotted-notation (defense in depth; URL parser
 *                          normally normalises this to compressed hex before we see it)
 *   ::HHHH:HHHH          – compressed pure-hex, exactly 2 groups after :: (the common
 *                          form after WHATWG URL normalization, e.g. ::7f00:1)
 *   0:0:0:0:0:0:a.b.c.d  – fully-expanded dotted
 *   0:0:0:0:0:0:HHHH:HHHH – fully-expanded hex
 */
export function extractIPv4Compatible(host: string): string | null {
  // Compressed dotted: ::a.b.c.d
  const m1 = /^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (m1) return m1[1];

  // Compressed pure-hex: exactly 2 hex groups after :: means 6 implicit zero groups.
  const m2 = /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (m2) {
    const hi = parseInt(m2[1], 16);
    const lo = parseInt(m2[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }

  // Fully-expanded dotted: six zero-groups + IPv4
  const m3 = /^(?:0+:){6}(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (m3) return m3[1];

  // Fully-expanded hex: six zero-groups + two hex groups
  const m4 = /^(?:0+:){6}([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (m4) {
    const hi = parseInt(m4[1], 16);
    const lo = parseInt(m4[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }

  return null;
}

export const validateUrlPolicy = (rawUrl: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }

  // Strip IPv6 brackets so checks work uniformly (URL.hostname keeps them).
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTS.has(host) || BLOCKED_IPS.has(host)) {
    throw new Error(`Blocked host: ${host}`);
  }

  if (PRIVATE_RANGES.some((range) => range.test(host))) {
    throw new Error(`Blocked private IP range: ${host}`);
  }

  if (BLOCKED_IPV6_PREFIXES.some((prefix) => host.startsWith(prefix))) {
    throw new Error(`Blocked IPv6 address: ${host}`);
  }

  // IPv4-compatible IPv6 (::x.x.x.x / ::HHHH:HHHH): extract the embedded IPv4 and
  // run it through the same blocking rules to close the SSRF bypass.
  const embedded = extractIPv4Compatible(host);
  if (embedded !== null && isBlockedIPv4(embedded)) {
    throw new Error(`Blocked IPv4-compatible IPv6 address: ${host} (embeds ${embedded})`);
  }

  return parsed;
};

export const urlPolicyStage: Stage = {
  name: 'url-policy',
  async execute(ctx) {
    if (!ctx.url) {
      throw new Error('URL is required');
    }

    const parsed = validateUrlPolicy(ctx.url);
    return { ...ctx, url: parsed.toString() };
  },
};
