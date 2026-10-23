import { AGENT_NAME } from '../tasks/task-runtime.mjs';

// The first message of an auto-investigation (SPEC-automations-01 FR-19, FR-20). The method is the plugin's rca skill; how this
// client wants each kind of problem handled is in its knowledge (a playbook), which Sonic reads, checks and goes beyond.

const PLAYBOOK_HINT = { pipelineFailed: 'playbooks/pipeline-failed.md', pipelineLate: 'playbooks/pipeline-late.md', dqFailed: 'playbooks/dq-failed.md' };
const SEARCH_TERMS = { pipelineFailed: 'pipeline failure playbook', pipelineLate: 'pipeline delayed missed run playbook', dqFailed: 'data quality check failure playbook' };
const when = value => (value ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'unknown time');

export function alertHeadline(alert) {
  const name = alert.subject?.name || alert.subject?.id || 'an asset';
  const count = alert.occurrences?.length || 0;
  if (alert.trigger === 'pipelineFailed') return `Pipeline ${name} failed${count > 1 ? ` (${count} failed runs)` : ''}`;
  if (alert.trigger === 'dqFailed') return `Data quality checks failed on ${name}${count > 1 ? ` (${count} results)` : ''}`;
  const kinds = new Set((alert.occurrences || []).map(item => item.kind));
  if (kinds.size === 1 && kinds.has('long_running')) return `Pipeline ${name} is running much longer than usual`;
  if (kinds.has('missed')) return `Pipeline ${name} missed ${count === 1 ? 'a scheduled run' : `${count} scheduled runs`}`;
  return `Pipeline ${name} did not start on time`;
}

function evidence(alert) {
  if (alert.trigger === 'pipelineFailed') return [
    'Read the failed run first: its output, the failing task and its error (get_pipeline_runs, then the platform for task-level logs).',
    'Establish recency: is the newest run still failing, already recovered, or failing differently?',
    'Compare the failed run with the last successful one: inputs, code and configuration revisions, compute, permissions, data volume, schedule.',
    'Check the data with query_data (one read-only SELECT at a time): upstream inputs for the run window and the tables it writes.',
  ];
  if (alert.trigger === 'pipelineLate') return [
    'Check whether the schedule is paused or was edited, and the job settings (queueing, maximum concurrent runs, triggers).',
    'Look for what held it: a run still going from the previous slot, a queue, cluster or warehouse start-up, an upstream job or file arrival that is late, an outage.',
    'Compare with the slots that did run on time, and with the typical duration.',
    'Say which downstream tables are now stale and since when (query_data, show_lineage).',
  ];
  return [
    'Read each failing check: its rule, the failed row count and the message.',
    'Look at the failing rows with query_data (one read-only SELECT, small results) and find when the data first went wrong.',
    'Trace upstream with show_lineage to the first layer where the data diverges; check the pipeline runs that loaded it.',
    'Say what downstream use is affected.',
  ];
}

function occurrenceLines(alert) {
  return (alert.occurrences || []).slice(-20).map(item => {
    if (alert.trigger === 'pipelineFailed') return `- run ${item.runId} failed at ${when(item.at)}${item.failingTask ? `, task ${item.failingTask}` : ''}${item.summary ? `: ${String(item.summary).slice(0, 300)}` : ''}`;
    if (alert.trigger === 'dqFailed') return `- ${item.checkName || item.checkId} (${item.severity || 'unknown severity'}) ${item.kind} at ${when(item.at)}${item.failedRows != null ? `, ${item.failedRows} failed rows` : ''}${item.summary ? `: ${String(item.summary).slice(0, 200)}` : ''}`;
    if (item.kind === 'long_running') return `- run ${item.runId} has been running ${Math.round(item.runningMs / 60000)} min, usually ${Math.round(item.typicalDurationMs / 60000)} min`;
    if (item.kind === 'late_start') return `- slot ${when(item.slot)}: run ${item.runId} started late, at ${when(item.startedAt)}`;
    return `- slot ${when(item.slot)}: ${item.kind === 'missed' ? 'no run ever started' : 'no run has started yet'}`;
  });
}

/** The task's first message for an alert. `permission` decides the line about changes; `ticket` names the ticket when there is one. */
export function alertPrompt(alert, { permission = 'read-only', playbook = '', ticket = null } = {}) {
  const lines = [`${alertHeadline(alert)}. Investigate it now, on your own.`];
  lines.push(permission === 'read-only' ? 'Read-only: do not change any system. Describe any change you would make instead.' : 'Any change needs approval under the project policy: propose it, with what it touches, and wait for the approval.');
  lines.push('', 'What happened:', ...occurrenceLines(alert));
  if (alert.subject?.platform) lines.push(`Platform: ${alert.subject.platform}. ${alert.subject.type === 'pipeline' ? `Pipeline id: ${alert.subject.id}.` : ''}`);
  if (ticket) lines.push(`This is tracked on ticket ${ticket.number || ticket.ticketId}; NerveCenter posts your result there.`);
  lines.push('', 'How to work:');
  lines.push('1. Use the rca skill as your method (and the monitoring skill to establish the live state first).');
  lines.push(`2. Knowledge first: ${playbook ? `this project's playbook for this is ${playbook}; Read it.` : `call search_knowledge for "${SEARCH_TERMS[alert.trigger]}" and for "${alert.subject?.name || ''}"; if a playbook exists (for example ${PLAYBOOK_HINT[alert.trigger]}), Read it.`} Follow the steps that apply, check each against the evidence, and go beyond it where the evidence leads. With no playbook, reason from the rca method.`);
  lines.push('3. Evidence:', ...evidence(alert).map(line => `   - ${line}`));
  lines.push('', 'Finish with, in this order: the likely cause in one line; the evidence; the proposed fix and the approval it needs; your confidence and the next check if unsure; the playbook you used (or "none"), where you deviated from it and why, and any knowledge update you would propose.');
  lines.push(`Nobody is waiting to answer: a person reads this later${ticket ? ' on the task and the ticket' : ' on the task'}. Do not ask a question; end with the recommendation.`);
  return lines.join('\n');
}

/** What NerveCenter writes on the ticket at each step (FR-36). Plain sentences; the ticket's readers may not use the app. */
export const ticketNotes = {
  started: (alert, taskId) => `${AGENT_NAME} started investigating automatically (task ${taskId}). ${alertHeadline(alert)}.`,
  occurrence: (alert, items) => `It happened again: ${items.map(item => item.runId ? `run ${item.runId}` : item.slot ? `slot ${when(item.slot)}` : item.checkName || item.checkId).join(', ')}.`,
  finished: (task) => `${AGENT_NAME}'s findings${task.status === 'failed' ? ' (the investigation stopped early)' : ''}:\n\n${task.report || task.summary || task.error || 'No summary was produced.'}`,
  recovered: (alert, recovery) => `Recovered${recovery?.runId ? `: run ${recovery.runId} succeeded` : recovery?.checkId ? `: check ${recovery.checkId} passed` : ''}${recovery?.at ? ` at ${when(recovery.at)}` : ''}. ${alertHeadline(alert)} is no longer happening.`,
};

export function ticketDraft(alert) {
  const title = alertHeadline(alert);
  const description = [title + '.', '', ...occurrenceLines(alert), '', `Opened automatically by NerveCenter. ${AGENT_NAME} investigates and posts findings here.`].join('\n');
  return { title, description };
}
