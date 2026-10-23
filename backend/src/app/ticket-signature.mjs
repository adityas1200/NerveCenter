import { createHash } from 'node:crypto';

// A failure signature is a short hash that stays the same when the same failure comes back with a
// different run id, timestamp, path or row count. Pipeline failures sign on where and how they failed
// (platform, pipeline, failing task, exception class, normalised error text); every other ticket signs
// on a fingerprint of its title and description. Pure: no store, no clock.

const STOP = new Set('a about after all also an and any are as at be been but by can could did do does for from had has have how if in into is it its may more no not of on or our out so some than that the their then there these they this to up was we were what when where which who will with would you your'.split(' '));
const IDS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // uuids
  /\b[a-z][a-z0-9+.-]*:\/\/\S+|\bdbfs:\/\S+/gi, // urls and storage uris
  /\b[a-z]:\\\S*/gi, // windows paths
  /(?<![\w/])(?:\/[\w.@%+~$-]+){2,}\/?/g, // unix paths with two or more segments
  /\b\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?)?/gi, // iso dates and times
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?/g, // other dates and times
  /\b0x[0-9a-f]+\b|\b(?=[0-9a-f]*\d)[0-9a-f]{7,}\b/gi, // hex values and hashes
  /\d+/g, // any other number or id
];
const EXCEPTION_CLASS = /\b(?:[a-z_]\w*\.)*([A-Z]\w*(?:Exception|Error))\b/;
const hash = (prefix, text) => `${prefix}:${createHash('sha1').update(text).digest('hex').slice(0, 16)}`;

/** Lower-case words only: ids, numbers, timestamps, paths, uuids and hex stripped. */
export function normalizeText(text) {
  let out = String(text || '');
  for (const pattern of IDS) out = out.replace(pattern, ' ');
  return out.toLowerCase().replace(/[^a-z_]+/g, ' ').trim();
}

/** Words worth matching on: normalised, no stop words, at least two letters. */
export const tokenize = text => normalizeText(text).split(' ').filter(word => word.length >= 2 && !STOP.has(word));

export const exceptionClass = text => EXCEPTION_CLASS.exec(String(text || ''))?.[1]?.toLowerCase() || '';

const isPipelineFailure = ticket => Boolean(ticket?.pipelineId) || ticket?.type === 'pipeline_failure';

/** The signature of a ticket, or null when there is nothing to sign (an empty ticket, a pull request). */
export function failureSignature(ticket) {
  if (!ticket || ticket.type === 'pull_request') return null;
  if (isPipelineFailure(ticket)) {
    const error = String(ticket.failureSummary || ticket.description || ticket.title || '');
    const parts = [ticket.platform || ticket.source, ticket.pipelineId, ticket.failingTask || ticket.metadata?.failingTask, exceptionClass(error), normalizeText(error).slice(0, 300)].map(part => String(part || '').trim().toLowerCase());
    if (!parts[1] && !parts[4]) return null;
    return hash('pipe', parts.join('|'));
  }
  const words = [...new Set(tokenize(`${ticket.title || ''} ${String(ticket.description || '').slice(0, 1000)}`))].sort().slice(0, 60);
  return words.length >= 2 ? hash('text', words.join(' ')) : null;
}
