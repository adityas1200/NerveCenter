import { pipelineHealth } from '../platform/pipeline-health.mjs';
import { httpError } from '../lib/util.mjs';
import { agentLines, agentToday } from './overview-agent.mjs';

// SPEC-platform-manual-refresh FR-2. Bucket edges come from the browser's timezone.
export function overviewQuery(params) {
  const from = params.get('from') || null;
  const to = params.get('to') || null;
  for (const value of [from, to]) if (value && !Number.isFinite(Date.parse(value))) throw httpError(400, 'Invalid reporting date.');
  if (from && to && Date.parse(from) >= Date.parse(to)) throw httpError(400, 'Reporting start must precede end.');
  let buckets;
  try { buckets = JSON.parse(params.get('buckets') || '[]'); } catch { throw httpError(400, 'Invalid chart buckets.'); }
  if (!Array.isArray(buckets) || buckets.length > 60 || buckets.some((b, i) => !Array.isArray(b) || b.length !== 2 || !b.every(Number.isSafeInteger) || b[0] >= b[1] || (i && b[0] !== buckets[i - 1][1]))) throw httpError(400, 'Invalid chart buckets.');
  return { from, to, buckets };
}

const counts = (rows, buckets, at) => buckets.map(([start, end]) => rows.filter(row => { const ms = Date.parse(at(row)); return ms >= start && ms < end; }).length);

// ADR 0021: counted in the store over what the reader may see; no ticket rows reach Node.
export async function overviewTickets(service, user, scope, query) {
  const generatedAt = new Date().toISOString();
  return { generatedAt, ...(await service.ticketOverview(user, { ...query, scope })) };
}

export async function overviewPipelines(service, scope, query) {
  let inventory;
  try { inventory = await service._monitorInventory({ scope, limit: 1000, maxRuns: 100 }); }
  catch (error) {
    if (!/not configured|not connected|no .*platform|configure /i.test(error.message)) throw error;
    return { generatedAt: new Date().toISOString(), capability: { available: false, reason: error.message }, platform: 'Databricks', counts: { succeeded: 0, failed: 0, missed: 0, paused: 0, total: 0, other: 0 }, chart: { succeeded: query.buckets.map(() => 0), failed: query.buckets.map(() => 0) } };
  }
  const key = row => `${row.platform || 'unknown'}:${row.pipelineId}`;
  const ids = new Set(inventory.pipelines.map(key));
  const allRuns = inventory.runs.filter(r => ids.has(key(r)));
  const rows = inventory.pipelines.map(p => ({ ...p, ...pipelineHealth({ schedule: p.schedule, runs: allRuns.filter(r => key(r) === key(p)), now: Date.now() }) }));
  const count = (...states) => rows.filter(p => states.includes(p.health)).length;
  const succeeded = count('healthy', 'running'), failed = count('failed'), missed = count('overdue'), paused = count('paused');
  const total = rows.length;
  const runs = allRuns.filter(r => (!query.from || Date.parse(r.startTime) >= Date.parse(query.from)) && (!query.to || Date.parse(r.startTime) <= Date.parse(query.to)));
  return { generatedAt: new Date().toISOString(), capability: { available: true, reason: '' }, platform: rows[0]?.platform || 'Databricks', counts: { succeeded, failed, missed, paused, total, other: Math.max(0, total - succeeded - failed - missed - paused) }, chart: {
    succeeded: counts(runs.filter(r => ['healthy', 'success', 'succeeded', 'successful', 'completed'].includes(String(r.status).toLowerCase())), query.buckets, r => r.startTime),
    failed: counts(runs.filter(r => ['failed', 'failure', 'error', 'timed_out', 'timedout', 'cancelled', 'canceled'].includes(String(r.status).toLowerCase())), query.buckets, r => r.startTime),
  } };
}

// ADR 0021: eight ranked rows chosen in the store; the pipeline monitor only runs when the reader has no work of their own.
export async function overviewWork(service, user, scope) {
  const generatedAt = new Date().toISOString();
  return { generatedAt, ...(await service.attentionWork(user, { scope })) };
}

export async function overviewAgent(store, scope, query) {
  const [tasks, inbox] = await Promise.all([store.listTasks(scope, { limit: 200 }), store.listInbox(scope, { status: 'pending', limit: 200 })]);
  const today = agentToday(tasks, query);
  // Only the latest task identity/title/time is displayed; don't transfer its context or history.
  const last = today.last;
  return { generatedAt: new Date().toISOString(), today: { ...today, last: last ? { id: last.id, title: last.title, createdAt: last.createdAt, updatedAt: last.updatedAt } : null }, lines: agentLines(tasks, query), waiting: inbox.filter(i => i.kind === 'approval' || i.kind === 'question').length };
}

export async function overviewDataQuality(service, query) {
  if (!service) return { generatedAt: new Date().toISOString(), configured: false, summary: { total: 0, passed: 0, warning: 0, failed: 0 }, source: null };
  const data = await service.monitor({ from: query.from || undefined, to: query.to || undefined, range: 'All time', limit: 100 });
  return { generatedAt: data.fetchedAt, configured: data.configured, summary: data.summary, source: data.configuration ? `${data.configuration.schema}.${data.configuration.resultTable}` : null };
}
