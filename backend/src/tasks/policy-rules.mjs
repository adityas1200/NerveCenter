import { cleanString as clean } from '../lib/util.mjs';
// Scoped policy rules, in the spirit of an AWS IAM policy document.
//
// The categories in operations.yaml `policy` are the baseline: what a task may do anywhere.
// A rule narrows or widens one category for particular resources:
//
//   policy:
//     production_changes: ask            # the baseline, unchanged
//     rules:
//       - effect: deny
//         action: production_changes
//         resource: databricks:prod:*    # never in production
//       - effect: allow
//         action: production_changes
//         resource: databricks:dev:*     # freely in development
//
// Every rule that matches a call is collected and the most restrictive one wins:
// deny beats ask beats allow. An explicit deny can therefore never be widened by another
// rule, which is the property that makes writing a deny worth anything. When no rule
// matches, the category's baseline decides, exactly as before rules existed.
//
// Uncertainty never widens permission. When the engine cannot tell which environment or
// object a call touches, that segment is `-`: it still matches a deny or ask rule (so a
// deny keeps biting) but never an allow rule (so an allow never fires on a guess).

export const EFFECTS = ['deny', 'ask', 'allow'];
/** Most restrictive first: the order that decides which matching rule wins. */
const STRENGTH = { deny: 3, ask: 2, allow: 1 };
const RESOURCE_SEGMENTS = ['system', 'environment', 'type', 'name'];
/** The segment written when the engine could not work out what a call touches. */
const UNKNOWN = '-';


/**
 * `system:environment:type:name`, with `-` for anything unknown. Written by the engine for
 * each call and matched against a rule's `resource`.
 */
export function resourceString({ system, environment, type, name } = {}) {
  return [system, environment, type, name].map(part => clean(part) || UNKNOWN).join(':');
}

/**
 * A resource pattern, padded to four segments: `databricks:prod` covers every type and name
 * inside it, and a bare `*` covers everything. Unlike an ARN wildcard, `*` does not run past
 * a `:` — padding makes the common patterns behave the same way while staying predictable.
 */
function segments(pattern) {
  const parts = String(pattern ?? '').split(':').map(part => part.trim());
  while (parts.length < RESOURCE_SEGMENTS.length) parts.push('*');
  return parts.slice(0, RESOURCE_SEGMENTS.length);
}

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `*` for any run of characters, `?` for one. Nothing else is special. */
function globMatches(pattern, value) {
  if (pattern === '*') return true;
  const source = `^${escapeRegExp(pattern).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`;
  return new RegExp(source, 'i').test(value);
}

/**
 * Whether a rule's resource pattern covers a resource the call touches.
 * `lenient` is on for deny and ask: an unknown segment then satisfies any constraint, so a
 * rule that restricts production still applies to a call whose environment could not be read.
 */
export function resourceMatches(pattern, resource, { lenient = false } = {}) {
  const wanted = segments(pattern);
  const actual = segments(resource);
  return wanted.every((part, index) => {
    if (part === '*') return true;
    if (actual[index] === UNKNOWN) return lenient;
    return globMatches(part, actual[index]);
  });
}

/** Drop anything malformed rather than guessing at it; `problems` explains each one for settings validation. */
export function normalizeRules(rules, { categories = [] } = {}) {
  const out = []; const problems = [];
  if (rules === undefined || rules === null) return { rules: out, problems };
  if (!Array.isArray(rules)) return { rules: out, problems: ['policy.rules must be a list'] };
  rules.forEach((raw, index) => {
    const at = `policy.rules[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { problems.push(`${at} must be a mapping`); return; }
    const effect = clean(raw.effect).toLowerCase();
    const action = clean(raw.action).toLowerCase() || '*';
    const resource = clean(raw.resource) || '*';
    if (!EFFECTS.includes(effect)) { problems.push(`${at}.effect must be ${EFFECTS.join(', ')}`); return; }
    if (action !== '*' && categories.length && !categories.includes(action)) { problems.push(`${at}.action must be * or one of: ${categories.join(', ')}`); return; }
    if (/[^\w.*?@:/\-]/.test(resource)) { problems.push(`${at}.resource has characters that are not allowed: ${resource}`); return; }
    out.push({ effect, action, resource, ...(clean(raw.description) ? { description: clean(raw.description).slice(0, 200) } : {}) });
  });
  return { rules: out, problems };
}

/**
 * The strongest effect among the rules that match this call, or null when none do.
 * `resources` is everything the call touches; a rule matching any one of them is enough,
 * so a statement that writes two tables is judged by the more restricted of the two.
 */
export function evaluateRules(rules, { action, resources = [] } = {}) {
  const targets = resources.length ? resources : [resourceString({})];
  let winner = null;
  for (const rule of rules || []) {
    if (rule.action !== '*' && rule.action !== action) continue;
    const lenient = rule.effect !== 'allow';
    if (!targets.some(resource => resourceMatches(rule.resource, resource, { lenient }))) continue;
    if (!winner || STRENGTH[rule.effect] > STRENGTH[winner.effect]) winner = rule;
  }
  return winner;
}

/** Problems with the `policy` section of operations.yaml, in the shape validateAgentSection returns. */
export function validatePolicySection(policy, { categories = [] } = {}) {
  if (policy === undefined || policy === null) return [];
  if (typeof policy !== 'object' || Array.isArray(policy)) return ['policy must be a mapping'];
  return normalizeRules(policy.rules, { categories }).problems;
}
