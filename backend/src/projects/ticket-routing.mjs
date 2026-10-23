// SPEC-projects-01 FR-26, FR-27: which project an imported ticket or a pipeline failure belongs to. A connection grant carries
// a scope filter and the filter is authoritative: ServiceNow `assignmentGroups[]`, Jira `projectKeys[]`, Databricks
// `jobInclude` (the same include syntax as pipeline-filter.mjs: a term matches a job whose name contains it, or whose id equals it).
// Pure functions: the grant service feeds them the holders of a connection.

export const UNROUTED = 'unrouted';
/** The grant-scope field that routes each provider's items. Providers not listed have no filter and cannot be split between projects. */
export const FILTER_FIELD = Object.freeze({ servicenow: 'assignmentGroups', jira: 'projectKeys', databricks: 'jobInclude' });
export const routesByFilter = provider => Object.hasOwn(FILTER_FIELD, provider);

const text = value => String(value ?? '').trim();
const key = value => text(value).toLowerCase();

/** The scope of a grant reduced to what routes this provider: a clean, de-duplicated list (Jira keys upper-cased), or {} for a provider without a filter. */
export function normalizeScope(provider, scope) {
  const field = FILTER_FIELD[provider]; if (!field) return {};
  const raw = scope && typeof scope === 'object' ? scope[field] : undefined;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const seen = new Set(); const values = [];
  for (const item of list) { const value = provider === 'jira' ? text(item).toUpperCase() : text(item); if (value && !seen.has(key(value))) { seen.add(key(value)); values.push(value); } }
  return values.length ? { [field]: values } : {};
}
export const filterValues = (provider, scope) => normalizeScope(provider, scope)[FILTER_FIELD[provider]] || [];

/** Do two filter values catch a common item? Names compare without case; Databricks terms also overlap when one is part of the other. */
export function valuesOverlap(provider, a, b) {
  const left = key(a); const right = key(b);
  if (!left || !right) return false;
  return provider === 'databricks' ? left.includes(right) || right.includes(left) : left === right;
}

/** The first overlap between two scopes of one provider, as `{ mine, theirs }`, or null. An empty scope catches everything. */
export function scopeOverlap(provider, scopeA, scopeB) {
  const a = filterValues(provider, scopeA); const b = filterValues(provider, scopeB);
  if (!a.length && !b.length) return { mine: '(no filter)', theirs: '(no filter)' };
  if (!a.length) return { mine: '(no filter)', theirs: b[0] };
  if (!b.length) return { mine: a[0], theirs: '(no filter)' };
  for (const mine of a) for (const theirs of b) if (valuesOverlap(provider, mine, theirs)) return { mine, theirs };
  return null;
}

/** What a routing rule looks at in an imported ticket or a pipeline. */
export function routingValue(provider, item = {}) {
  if (provider === 'servicenow') return text(item.metadata?.serviceNow?.assignmentGroup);
  if (provider === 'jira') {
    const issueKey = text(item.metadata?.jira?.key || item.externalReference?.number);
    return issueKey.includes('-') ? issueKey.slice(0, issueKey.lastIndexOf('-')).toUpperCase() : '';
  }
  return '';
}

/** How well one grant filter catches the item: 0 for no match, higher for a more specific match (the longest Databricks term wins). */
function matchStrength(provider, values, item) {
  if (provider === 'databricks') {
    const name = key(item.name ?? item.title ?? item.pipelineName); const id = key(item.pipelineId);
    let best = 0;
    for (const term of values.map(key)) if ((name && name.includes(term)) || (id && id === term)) best = Math.max(best, term.length);
    return best;
  }
  const value = key(routingValue(provider, item));
  return value && values.some(entry => key(entry) === value) ? 1 : 0;
}

/**
 * The project an item belongs to: among the connection's holders (`[{ projectId, scope }]`, active projects only), the one
 * whose filter catches it. A holder with an empty scope is the catch-all when it is the only holder (FR-27 allows no other
 * shape). Two filters catching one item (possible only for Databricks terms that are not contained in each other) go to the
 * most specific term, then to the project id that sorts first. No holder or no match is `unrouted`.
 */
export function routeItem(provider, holders, item) {
  const list = holders.map(holder => ({ projectId: holder.projectId, values: filterValues(provider, holder.scope) }));
  if (!list.length) return { projectId: UNROUTED, reason: 'No project holds this connection' };
  if (!routesByFilter(provider)) return list.length === 1 ? { projectId: list[0].projectId, reason: 'The only project holding this connection' } : { projectId: UNROUTED, reason: 'Several projects hold this connection and it has no routing filter' };
  const scoped = list.filter(holder => holder.values.length);
  let best = null;
  for (const holder of scoped) {
    const strength = matchStrength(provider, holder.values, item);
    if (strength && (!best || strength > best.strength || (strength === best.strength && holder.projectId < best.projectId))) best = { projectId: holder.projectId, strength };
  }
  if (best) return { projectId: best.projectId, reason: `Matched the ${FILTER_FIELD[provider]} filter` };
  const open = list.filter(holder => !holder.values.length);
  if (open.length === 1 && list.length === 1) return { projectId: open[0].projectId, reason: 'The only project holding this connection, with no filter' };
  return { projectId: UNROUTED, reason: 'No project filter matches this item' };
}
