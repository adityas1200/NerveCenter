// Typed links between knowledge pages (SPEC-knowledge-04, ADR 0022). Relationships live in each page's
// frontmatter: a pipeline names its upstream feeds and brands, a brand its stakeholders. Knowledge stays
// plain files; these helpers only read, resolve and merge those fields.

export const LINK_FIELDS = Object.freeze(['upstream', 'downstream', 'pipelines', 'brands', 'markets', 'stakeholders', 'vendor', 'owner', 'asked_by', 'uses', 'applies_to', 'systems', 'refs', 'related', 'supersedes']);
export const SCALAR_FIELDS = Object.freeze(['sla', 'tier', 'response', 'journey', 'era', 'stale_after', 'expected']);
const LINKS = new Set(LINK_FIELDS);
const SCALARS = new Set(SCALAR_FIELDS);
const MAX_FIELDS = 15;
const MAX_VALUES = 20;
const MAX_VALUE = 200;

const asList = value => (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]).map(item => String(item).trim()).filter(Boolean);

/** The link fields a page declares, each as a list of trimmed strings. */
export function linksOf(data = {}) {
  const out = {};
  for (const field of LINK_FIELDS) { const values = asList(data[field]); if (values.length) out[field] = values.slice(0, MAX_VALUES); }
  return out;
}

/** The scalar fields a page declares, as strings. */
export function scalarsOf(data = {}) {
  const out = {};
  for (const field of SCALAR_FIELDS) { const value = data[field]; if (value !== undefined && value !== null && value !== '' && !Array.isArray(value) && typeof value !== 'object') out[field] = String(value).slice(0, MAX_VALUE); }
  return out;
}

/** A value as a page key: trimmed, forward slashes, no leading ./ or /, lower case, no .md. */
export function pageKey(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.?\/+/, '').replace(/\.(md|markdown)$/i, '').toLowerCase();
}

/** Resolve a link value to a page path of the base, or null when it names something outside it (FR-5). */
export function resolveTarget(value, pagesByKey) {
  const key = pageKey(value);
  return key ? pagesByKey.get(key) || null : null;
}

/** Index of a base's page paths by key, for resolveTarget. */
export function indexPages(paths) { const map = new Map(); for (const page of paths) map.set(pageKey(page), page); return map; }

/** Validate `fields` from update_knowledge (FR-7): only known keys, bounded sizes. Returns a clean copy. */
export function cleanFields(fields) {
  if (fields === undefined || fields === null) return null;
  if (typeof fields !== 'object' || Array.isArray(fields)) throw new Error('fields must be an object of link and scalar fields');
  const entries = Object.entries(fields);
  if (entries.length > MAX_FIELDS) throw new Error(`Give at most ${MAX_FIELDS} fields`);
  const out = {};
  for (const [key, value] of entries) {
    if (LINKS.has(key)) {
      const values = asList(value);
      if (values.length > MAX_VALUES) throw new Error(`${key} takes at most ${MAX_VALUES} values`);
      for (const item of values) if (item.length > MAX_VALUE) throw new Error(`A value in ${key} is longer than ${MAX_VALUE} characters`);
      if (values.length) out[key] = [...new Set(values)];
    } else if (SCALARS.has(key)) {
      if (Array.isArray(value) || (value !== null && typeof value === 'object')) throw new Error(`${key} takes one value, not a list`);
      const text = String(value ?? '').trim();
      if (text.length > MAX_VALUE) throw new Error(`${key} is longer than ${MAX_VALUE} characters`);
      if (text) out[key] = text;
    } else {
      throw new Error(`Unknown field ${key}. Link fields: ${LINK_FIELDS.join(', ')}. Scalar fields: ${SCALAR_FIELDS.join(', ')}`);
    }
  }
  return Object.keys(out).length ? out : null;
}

/** One YAML scalar, quoted only when YAML needs it. */
export function yamlScalar(value) {
  const text = String(value);
  return /^[\w .,/()&+@-]*$/.test(text) && !/^\s|\s$|^[-?:,[\]{}#&*!|>'"%@`]/.test(text) && !/^(true|false|null|yes|no|on|off|~)$/i.test(text) && !/^[\d.:-]+$/.test(text) ? text : JSON.stringify(text);
}
const yamlList = values => `[${values.map(item => (/[,[\]{}:#]/.test(item) || /^\s|\s$/.test(item) || /^['"&*!|>%@`-]/.test(item) ? JSON.stringify(item) : item)).join(', ')}]`;

/** Frontmatter lines for a new page's fields (FR-8). */
export function fieldLines(fields) {
  if (!fields) return [];
  return Object.entries(fields).map(([key, value]) => `${key}: ${Array.isArray(value) ? yamlList(value) : yamlScalar(value)}`);
}

/**
 * Merge fields into a page's frontmatter (FR-9): list values are added without duplicates, a scalar is set.
 * `current` is the page's parsed frontmatter data. A page without frontmatter gets one.
 */
export function mergeFields(text, current, fields) {
  if (!fields) return text;
  const source = String(text);
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  const lines = match ? match[1].split(/\r?\n/) : [];
  const body = match ? source.slice(match[0].length) : source;
  for (const [key, value] of Object.entries(fields)) {
    const line = Array.isArray(value)
      ? `${key}: ${yamlList([...new Set([...asList(current?.[key]), ...value])])}`
      : `${key}: ${yamlScalar(value)}`;
    const at = lines.findIndex(item => new RegExp(`^${key}:`).test(item));
    if (at === -1) { lines.push(line); continue; }
    // Drop a block list that followed the key, then write the merged value on the key's line.
    let end = at + 1; while (end < lines.length && /^\s+-\s/.test(lines[end])) end += 1;
    lines.splice(at, end - at, line);
  }
  return `---\n${lines.join('\n')}\n---\n${match ? body : `\n${body}`}`;
}
