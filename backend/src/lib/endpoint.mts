import { isIP } from 'node:net';

// Endpoint rules shared by the connection code. Real systems must be reached over HTTPS; plain
// HTTP is accepted only for loopback addresses so a developer can point the app at a service
// running on their own machine (a stub or a local proxy) without a certificate.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLoopbackHost(hostname: unknown): boolean {
  const host = String(hostname || '').toLowerCase();
  const isIpv4Loopback = isIP(host) === 4 && Number(host.split('.')[0]) === 127;
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost') || isIpv4Loopback;
}

/** Parse a system URL and return its origin. HTTPS anywhere; HTTP only on loopback. */
export function normalizeOrigin(value: unknown, { label = 'URL' }: { label?: string } = {}): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`${label} is required`);
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new Error(`${label} must be a valid HTTPS address`); }
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`);
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) throw new Error(`${label} must use HTTPS (plain HTTP is only allowed for localhost)`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${label} must be a valid HTTPS address`);
  return url.origin;
}

/** Scheme for a bare host[:port]: HTTP for loopback, HTTPS otherwise. */
export function schemeForHost(host: unknown): 'http' | 'https' {
  const hostname = String(host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return isLoopbackHost(hostname) ? 'http' : 'https';
}
