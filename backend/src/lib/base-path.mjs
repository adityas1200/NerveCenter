// Lets one process sit behind a path-prefixed ingress (an ALB rule for /apps/nervecenter/*) the way
// the EC2 stack's nginx does: requests may arrive with or without the prefix, and routing sees neither.

export function normalizeBasePath(raw) {
  const inner = String(raw || '').trim().replace(/^\/+|\/+$/g, '');
  return inner ? `/${inner}` : '';
}

export function stripBasePath(pathname, base) {
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}
