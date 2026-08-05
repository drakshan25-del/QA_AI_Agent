import { promises as dns } from 'dns';
import { isIP } from 'net';
import { ValidationFailedException } from '../../common/errors';

/**
 * SSRF protection for user-supplied scan targets (FR-UIS-023, SEC-003).
 *
 * The scan URL comes from the browser but the browser that opens it runs on
 * the engine host, inside the trusted network — so without this check an
 * authenticated user could make the platform fetch anything the platform can
 * reach. The same rules are enforced again inside the engine
 * (`engine/uiscanner/url_guard.py`) so a direct engine call cannot bypass them
 * either; this copy gives the user an immediate, actionable 400 instead of a
 * failed scan.
 *
 * Allowed: http and https, to hosts that do not resolve into a private,
 * loopback, link-local, reserved or carrier-grade-NAT range. A project's
 * `allowedDomains` re-enables specific internal hosts for local development.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Hostnames that hand out instance credentials on the major clouds. */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata',
]);

/** Addresses that serve cloud metadata regardless of the hostname used. */
const BLOCKED_ADDRESSES = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'fd00:ec2::254',
]);

export interface UrlSafetyOptions {
  /** Hosts allowed even when they resolve into a private range. */
  allowedHosts?: string[];
  /** Development escape hatch for a fully local stack. */
  allowPrivateNetwork?: boolean;
}

export interface SafeUrl {
  url: string;
  hostname: string;
  addresses: string[];
  /** Origin + path, used as the locator's page pattern (no query or hash). */
  pagePattern: string;
}

function ipv4ToLong(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function isPrivateIpv4(address: string): boolean {
  const value = ipv4ToLong(address);
  if (value === null) return true; // unparseable → treat as unsafe
  const inRange = (cidrStart: string, bits: number): boolean => {
    const start = ipv4ToLong(cidrStart);
    if (start === null) return false;
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (start & mask) >>> 0;
  };
  return (
    inRange('0.0.0.0', 8) ||
    inRange('10.0.0.0', 8) ||
    inRange('100.64.0.0', 10) || // carrier-grade NAT
    inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) || // link-local (includes IMDS)
    inRange('172.16.0.0', 12) ||
    inRange('192.0.0.0', 24) ||
    inRange('192.168.0.0', 16) ||
    inRange('198.18.0.0', 15) ||
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalised = address.toLowerCase().split('%')[0];
  if (normalised === '::' || normalised === '::1') return true;
  if (normalised.startsWith('fe80') || normalised.startsWith('fec0')) return true; // link/site-local
  if (/^f[cd][0-9a-f]{2}:/.test(normalised)) return true; // unique-local
  if (normalised.startsWith('ff')) return true; // multicast
  // IPv4-mapped (::ffff:10.0.0.1) inherits the IPv4 verdict.
  const mapped = normalised.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]!);
  return false;
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

export function parseAllowedHosts(allowedDomains: string | undefined): string[] {
  return (allowedDomains || '')
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/^\*\./, ''))
    .filter(Boolean);
}

function hostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** Origin + path with the query string and fragment removed. */
export function toPagePattern(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '') || parsed.origin;
  } catch {
    return url;
  }
}

/**
 * Validate a scan target, resolving DNS and checking every returned address.
 *
 * @throws ValidationFailedException with an actionable message when the URL
 *   must not be opened.
 */
export async function assertUrlIsSafe(
  rawUrl: string,
  options: UrlSafetyOptions = {},
): Promise<SafeUrl> {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    throw new ValidationFailedException('A target URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationFailedException(
      `"${trimmed}" is not a valid absolute URL. Include the scheme, e.g. https://example.com/login.`,
    );
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new ValidationFailedException(
      `URLs using "${parsed.protocol}" cannot be scanned. Use http or https.`,
      { protocol: parsed.protocol },
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    throw new ValidationFailedException('The URL has no hostname.');
  }
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new ValidationFailedException(
      `"${hostname}" is a cloud metadata endpoint and cannot be scanned.`,
    );
  }

  const allowedHosts = options.allowedHosts ?? [];
  const explicitlyAllowed = hostAllowed(hostname, allowedHosts);

  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const records = await dns.lookup(hostname, { all: true, verbatim: true });
      addresses = records.map((r) => r.address);
    } catch {
      throw new ValidationFailedException(
        `The hostname "${hostname}" could not be resolved. Check the URL and that the host is reachable from the server.`,
      );
    }
  }
  if (!addresses.length) {
    throw new ValidationFailedException(
      `The hostname "${hostname}" did not resolve to any address.`,
    );
  }

  for (const address of addresses) {
    if (BLOCKED_ADDRESSES.has(address.toLowerCase())) {
      throw new ValidationFailedException(
        `"${hostname}" resolves to the cloud metadata address ${address} and cannot be scanned.`,
      );
    }
    if (
      isPrivateAddress(address) &&
      !options.allowPrivateNetwork &&
      !explicitlyAllowed
    ) {
      throw new ValidationFailedException(
        `"${hostname}" resolves to the internal address ${address}. Add the host to the project's allowed domains to scan it.`,
        { hostname, address },
      );
    }
  }

  return {
    url: parsed.toString(),
    hostname,
    addresses,
    pagePattern: toPagePattern(parsed.toString()),
  };
}
