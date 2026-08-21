import { NextRequest } from 'next/server';

const MAX_HEADER_LENGTH = 1024;

// Simple regex for basic IPv4 and IPv6 format checking
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const IPV6_REGEX = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}$|^(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}$|^(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}$|^:(?::[0-9a-fA-F]{1,4}){1,7}$|^::$|^::1$/;

/**
 * Normalizes an IP string (handling IPv6 brackets, ports, and ::ffff: mapped IPv4).
 */
export function normalizeIp(rawIp: string): string {
  let ip = rawIp.trim().toLowerCase();

  // Strip brackets from IPv6 (e.g. [::1]:8080 or [::1])
  if (ip.startsWith('[') && ip.includes(']')) {
    ip = ip.substring(1, ip.indexOf(']'));
  } else if (ip.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 (e.g., ::ffff:192.168.1.1)
    const ipv4Part = ip.substring(7);
    if (IPV4_REGEX.test(ipv4Part)) {
      return ipv4Part;
    }
  } else if (ip.includes(':') && ip.includes('.')) {
    // IPv4 with port (e.g. 192.168.1.1:3000)
    const [host] = ip.split(':');
    if (IPV4_REGEX.test(host)) {
      return host;
    }
  }

  // IPv6 loopback normalization
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') {
    return '127.0.0.1';
  }

  return ip;
}

let hasWarnedMissingProxy = false;

/**
 * Resolves the client identity IP address.
 * Strictly ignores untrusted X-Forwarded-For headers unless TRUST_PROXY=true is configured.
 */
export function resolveClientIp(req: NextRequest): string {
  const isTrustProxy = process.env.TRUST_PROXY === 'true';

  if (!isTrustProxy) {
    if (req.ip) {
      return normalizeIp(req.ip);
    }

    if (process.env.NODE_ENV === 'production' && !hasWarnedMissingProxy) {
      hasWarnedMissingProxy = true;
      console.warn(
        '[SECURITY CONFIGURATION WARNING] TRUST_PROXY is not set to "true" and direct req.ip is unavailable. ' +
        'In reverse-proxy environments (Nginx, Caddy, Cloudflare, AWS ALB), configure TRUST_PROXY=true to resolve client IPs correctly.'
      );
    }

    // When proxy is not trusted, ignore spoofable headers from the client
    return 'direct-client';
  }

  // Proxy is trusted: extract and validate header
  const xForwardedFor = req.headers.get('x-forwarded-for');
  const xRealIp = req.headers.get('x-real-ip');
  const cfConnectingIp = req.headers.get('cf-connecting-ip');

  const rawHeader = xForwardedFor || xRealIp || cfConnectingIp || req.ip;

  if (!rawHeader) {
    return 'unknown-client';
  }

  if (rawHeader.length > MAX_HEADER_LENGTH) {
    // Oversized header attack guard
    return 'malformed-oversized-ip';
  }

  // Handle multi-value proxy chains: "client, proxy1, proxy2"
  // The first (leftmost) entry is the client-reported IP
  const parts = rawHeader.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    return 'unknown-client';
  }

  const clientCandidate = normalizeIp(parts[0]);

  // Validate that the parsed string is a legitimate IPv4 or IPv6 address
  if (IPV4_REGEX.test(clientCandidate) || IPV6_REGEX.test(clientCandidate)) {
    return clientCandidate;
  }

  return 'malformed-client-ip';
}
