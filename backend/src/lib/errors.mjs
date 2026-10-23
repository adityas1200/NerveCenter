/**
 * One line for an error, including the causes Node hides behind "fetch failed"
 * (for example `unable to get local issuer certificate`). Secrets are stripped.
 */
export function errorText(error, fallback = 'Request failed') {
  const parts = [];
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const message = typeof current === 'string' ? current : String(current.message || '');
    const code = typeof current === 'object' && current.code && !message.includes(String(current.code)) ? String(current.code) : '';
    const text = [message, code ? `(${code})` : ''].filter(Boolean).join(' ').trim();
    if (text && !parts.includes(text)) parts.push(text);
    current = typeof current === 'object' ? current.cause : null;
  }
  return (parts.join(': ') || fallback).replace(/(authorization|password|token|secret)\s*[:=]?\s*[^\s,;]+/ig, '$1 [redacted]').slice(0, 400);
}
