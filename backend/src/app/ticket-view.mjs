// How a ticket reads in NerveCenter, whatever system it came from.
//
// Source systems each have their own states (ServiceNow "On Hold", Jira "In Review"...). People
// using NerveCenter need four, and the same four everywhere:
//   open            nobody owns it and the agent is not working on it
//   in_progress     a person owns it, the source says work started, or the agent is working on it
//   waiting_on_you  the agent paused on it for an approval or an answer
//   closed          resolved, closed or cancelled, here or in the source
// The raw source state stays on the ticket (`status`, `sourceStatus`) for anyone who needs it.

import { CLOSED_STATUSES as CLOSED } from '../lib/util.mjs';

// Lower weight sorts first; a priority outside the list weighs 4.
export const PRIORITY_WEIGHT = { critical: 0, high: 1, medium: 2, low: 3 };

// People arrive from ServiceNow and Jira by name and email, and sign in to NerveCenter by id.
// Two references are the same person when any of id, email, email user part or name agree.
export const identityKeys = member => {
  if (!member) return [];
  if (typeof member === 'string') return [member.toLowerCase(), ...(member.includes('@') ? [member.split('@')[0].toLowerCase()] : [])];
  const keys = [member.id, member.email, member.name].filter(Boolean).map(value => String(value).toLowerCase());
  for (const value of [member.email, member.id]) if (String(value || '').includes('@')) keys.push(String(value).split('@')[0].toLowerCase());
  return keys;
};
export const sameIdentity = (left, right) => { const a = identityKeys(left); const b = new Set(identityKeys(right)); return a.length > 0 && a.some(key => b.has(key)); };

const STARTED = new Set(['in_progress', 'waiting', 'awaiting_approval']);
export const APP_STATUS_LABELS = { open: 'Open', in_progress: 'In progress', waiting_on_you: 'Waiting on you', closed: 'Closed' };

export const isClosedTicket = ticket => CLOSED.has(String(ticket?.status || '').toLowerCase());
const hasOwner = ticket => Boolean(typeof ticket?.assignee === 'string' ? ticket.assignee : ticket?.assignee?.id || ticket?.assignee?.name);

export function appStatus(ticket) {
  if (isClosedTicket(ticket)) return 'closed';
  const task = String(ticket?.taskStatus || '');
  if (task === 'waiting') return 'waiting_on_you';
  if (task === 'running' || task === 'queued' || hasOwner(ticket) || STARTED.has(String(ticket?.status || '').toLowerCase())) return 'in_progress';
  return 'open';
}

/**
 * What the agent is doing about the ticket, in words a person can act on: its state, the one-line
 * summary, the longer report (the reply's opening paragraphs), when it finished and how many changes it made.
 */
function agentView(ticket) {
  const task = String(ticket?.taskStatus || '');
  if (!ticket?.taskId) return { state: 'none', label: 'Not looked at', summary: null, report: null, taskId: null, finishedAt: null, changes: 0 };
  const base = { summary: ticket.agentSummary || null, report: ticket.agentReport || null, taskId: ticket.taskId, finishedAt: ticket.taskFinishedAt || null, changes: Number(ticket.taskChanges || 0) };
  if (task === 'running' || task === 'queued') return { state: 'working', label: 'Working on it', ...base };
  if (task === 'waiting') return { state: 'waiting', label: 'Needs you', ...base };
  if (task === 'failed') return { state: 'failed', label: 'Stopped', ...base };
  if (task === 'cancelled') return { state: 'none', label: 'Cancelled', ...base };
  return { state: 'done', label: 'Findings ready', ...base };
}

/** Closed, and the agent made at least one real change on the way (not just reading). */
export const resolvedWithAgent = ticket => isClosedTicket(ticket) && Boolean(ticket?.taskId) && Number(ticket?.taskChanges || 0) > 0;

/** What the ticket is about, for grouping: pipeline, data_quality, access or other. */
function ticketKind(ticket) {
  const text = [ticket?.category, ticket?.type, ...(ticket?.tags || []), ticket?.title].join(' ').toLowerCase();
  if (ticket?.pipelineId || /pipeline|job fail|load failed|run failed/.test(text)) return 'pipeline';
  if (/\bdq\b|data.?quality|quality check/.test(text)) return 'data_quality';
  if (/access|offboard|entitlement|permission/.test(text)) return 'access';
  return 'other';
}

export const LINK_RELATIONS = ['recurrence_of', 'amends_fix_of', 'duplicate_of', 'related_to'];

/** Links to other tickets, and whether this ticket is the same failure coming back after an earlier fix. */
function linkView(ticket) {
  const links = Array.isArray(ticket?.links) ? ticket.links : [];
  const of = links.find(link => link.relation === 'recurrence_of' && link.direction === 'out');
  return { links, recurrence: of ? { ofTicketId: of.ticketId, detectedAt: of.at || null, auto: Boolean(of.auto) } : null };
}

export function decorateTicket(ticket) {
  if (!ticket) return ticket;
  return { ...ticket, ...linkView(ticket), sourceStatus: ticket.metadata?.serviceNow?.state || ticket.metadata?.jira?.status || ticket.status || null, appStatus: appStatus(ticket), agent: agentView(ticket), resolvedWithAgent: resolvedWithAgent(ticket), kind: ticketKind(ticket) };
}
