// Tiny helpers that were redefined in many files. Single-argument on purpose: they are passed to .map().
export const now = () => new Date().toISOString();
export const clone = value => structuredClone(value);
export const clean = value => String(value || '').trim();
export const cleanString = value => (typeof value === 'string' ? value.trim() : '');
export const slug = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
// An Error carrying the HTTP status the API layer sends back.
export const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
export const CLOSED_STATUSES = new Set(['closed', 'cancelled', 'resolved', 'archived']);
// The { id, name } a record keeps for a person; `fallback` is what a missing user becomes.
export const actorOf = (user, fallback = null) => (user ? { id: String(user.id), name: user.name || String(user.id) } : fallback);
