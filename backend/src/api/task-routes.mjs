import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';
import { actorOf } from '../lib/util.mjs';
import { safeJoin } from '../lib/fs.mjs';
import { NEXT, linkable, reply, route, scoped } from '../lib/router.mjs';
import { assertRowInScope } from '../projects/project-access.mjs';
import { httpError } from '../lib/util.mjs';
import { sendJson } from '../lib/http.mjs';
import { ATTACHMENT_REQUEST_BYTES, decodeAttachments } from '../tasks/attachments.mjs';
import { readGuide } from '../knowledge/knowledge-setup.mjs';

// Files the agent wrote under the task folder are served three ways: a tree, text content for the
// viewer, and raw bytes (images, PDFs, HTML) with the right content type. HTML and SVG are served with
// a sandbox CSP so a file the agent produced can never run script on the API origin.
const RAW_TYPES = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', log: 'text/plain', mmd: 'text/plain', sql: 'text/plain',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml', py: 'text/x-python',
  html: 'text/html', htm: 'text/html', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', zip: 'application/zip',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const RAW_MAX_BYTES = 20 * 1024 * 1024;
const TEXT_LIKE = new Set(['application/json', 'image/svg+xml']);

async function sendRawFile(res, dir, relative) {
  const file = safeJoin(dir, relative);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat || !stat.isFile()) return sendJson(res, 404, { error: 'File not found' });
  if (stat.size > RAW_MAX_BYTES) return sendJson(res, 413, { error: `File is larger than ${RAW_MAX_BYTES} bytes` });
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = RAW_TYPES[ext] || 'application/octet-stream';
  const headers = {
    'content-type': type.startsWith('text/') || TEXT_LIKE.has(type) ? `${type}; charset=utf-8` : type,
    'content-length': stat.size,
    'content-disposition': `inline; filename="${path.basename(file).replace(/["\r\n]/g, '')}"`,
    'cache-control': 'private, max-age=60',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': config.corsOrigin,
  };
  if (ext === 'html' || ext === 'htm' || ext === 'svg') headers['content-security-policy'] = 'sandbox';
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

/**
 * Decided approvals in the last `days`, grouped by policy category: how many were approved, how many
 * denied, and how many are still waiting. The autonomy control shows this next to each category so
 * widening what the agent may do without asking rests on what people actually approved.
 */
export async function approvalStats(taskStore, scope, days = 30) {
  const since = Date.now() - Math.max(1, Math.min(365, days)) * 86_400_000;
  const byCategory = {};
  for (let offset = 0; ; offset += 100) {
    const { items, total } = await taskStore.pageInbox(scope, { kind: 'approval', limit: 100, offset });
    for (const item of items) {
      const at = Date.parse(item.decidedAt || item.createdAt || ''); if (Number.isFinite(at) && at < since) continue;
      const key = item.category || 'default_write';
      const bucket = byCategory[key] ||= { category: key, label: item.categoryLabel || 'Change', approved: 0, denied: 0, pending: 0, cancelled: 0, lastDecidedAt: null };
      if (item.status === 'approved') bucket.approved += 1; else if (item.status === 'denied') bucket.denied += 1; else if (item.status === 'pending') bucket.pending += 1; else bucket.cancelled += 1;
      if (item.decidedAt && (!bucket.lastDecidedAt || item.decidedAt > bucket.lastDecidedAt)) bucket.lastDecidedAt = item.decidedAt;
    }
    if (offset + items.length >= total || items.length === 0) break;
  }
  const categories = Object.values(byCategory).sort((a, b) => (b.approved + b.denied) - (a.approved + a.denied));
  const totals = categories.reduce((acc, item) => ({ approved: acc.approved + item.approved, denied: acc.denied + item.denied, pending: acc.pending + item.pending }), { approved: 0, denied: 0, pending: 0 });
  return { days, since: new Date(since).toISOString(), totals, categories };
}

// Tasks, their live event stream, their files, and the Inbox.
const num = (value, fallback) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : fallback; };
const pageNumber = (value, fallback, max, name) => {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || (name === 'limit' && Number(value) === 0)) throw httpError(400, `${name} must be ${name === 'limit' ? 'a positive' : 'a nonnegative'} whole number.`);
  return Math.min(Number(value), max);
};
const notFound = reply(404, { error: 'Task not found' });

export function taskRoutes({ runtime, taskStore }) {
  if (!runtime) return [];
  // The by-id check every task and inbox route makes first (FR-13): load the row, then the one scope check.
  const taskIn = async (id, scope) => { const task = await taskStore.getTask(id); return assertRowInScope(scope, task); };
  const itemIn = async (id, scope) => { const item = await taskStore.getInboxItem(id); return assertRowInScope(scope, item); };
  const files = async ({ res, url, scope, params: { id, kind } }) => {
    if (!runtime.workspaces) return reply(404, { error: 'Task files are not available' });
    const row = await taskIn(id, scope);
    // The task's files are in its own project's workspace.
    const workspace = await runtime.workspaces.for(row.projectId);
    const task = await runtime.getTask(id); if (!task) return notFound;
    const dir = await workspace.taskDir(id);
    if (!kind) return { id, items: await workspace.tree(dir) };
    const relative = url.searchParams.get('path') || '';
    if (!relative) return reply(400, { error: 'path is required' });
    if (kind === 'content') return await workspace.readFile(dir, relative);
    if (kind === 'raw') { await sendRawFile(res, dir, relative); return; }
    return NEXT;
  };
  const events = async ({ req, res, url, scope, params: { id } }) => {
    await taskIn(id, scope);
    const task = await runtime.getTask(id); if (!task) return notFound;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': config.corsOrigin });
    let lastSeq = num(url.searchParams.get('after'), 0); let closed = false;
    const send = (name, data) => { if (!closed) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); };
    for (const event of await taskStore.listEvents(id, { afterSeq: lastSeq })) { send('event', event); lastSeq = event.seq; }
    send('task', task);
    const unsubscribe = runtime.subscribe(id, event => { if (event.seq > lastSeq) { lastSeq = event.seq; send('event', event); } });
    // Partial reply text and tool starts, live only (see TaskRuntime#handleStreamEvent).
    const unsubscribeDeltas = typeof runtime.subscribeDeltas === 'function' ? runtime.subscribeDeltas(id, delta => send('delta', delta)) : () => {};
    const onTask = updated => { if (updated.id === id) send('task', updated); }; runtime.on('task', onTask);
    const heartbeat = setInterval(() => { if (!closed) res.write(': keepalive\n\n'); }, 15_000); heartbeat.unref?.();
    req.on('close', () => { closed = true; clearInterval(heartbeat); unsubscribe(); unsubscribeDeltas(); runtime.off('task', onTask); });
  };
  return scoped('project', [
    route('GET', '/api/tasks', async ({ url, scope }) => {
      const paged = url.searchParams.has('offset');
      const filters = { type: url.searchParams.get('type') || undefined, status: url.searchParams.get('status') || undefined, archived: url.searchParams.get('archived') || undefined, limit: paged ? pageNumber(url.searchParams.get('limit'), 10, 100, 'limit') : num(url.searchParams.get('limit'), 100) };
      if (paged) return taskStore.pageTasks(scope, { ...filters, q: url.searchParams.get('q') || '', offset: pageNumber(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER, 'offset') });
      return { items: await taskStore.listTasks(scope, filters) };
    }),
    // A message may carry files (SPEC-tasks-11), so this and /messages read a larger body and check the files here.
    route('POST', '/api/tasks', async ({ body, user, scope }) => { const b = await body(ATTACHMENT_REQUEST_BYTES); const { attachments: files, ...rest } = b; const attachments = decodeAttachments(files, rest); return reply(201, await runtime.startTask({ type: b.type || 'adhoc', title: b.title, prompt: b.prompt, context: b.context || {}, permission: b.permission || 'policy', notify: b.notify !== false, user, scope, attachments })); }, 'tasks.manage'),
    route('GET', '/api/tasks/:id', async ({ params: { id }, scope }) => { await taskIn(id, scope); return (await runtime.getTask(id, { includeEvents: true })) || notFound; }),
    route('DELETE', '/api/tasks/:id', async ({ params: { id }, scope }) => { await taskIn(id, scope); return runtime.deleteTask(id); }, 'tasks.manage'),
    route('PATCH', '/api/tasks/:id', async ({ params: { id }, body, user, scope }) => { await taskIn(id, scope); const b = await body(); return b.archived !== undefined ? runtime.setArchived(id, user, b.archived) : runtime.setPermission(id, user, b.permission); }, 'tasks.manage'),
    route('GET', '/api/tasks/:id/logs', async ({ params: { id }, scope }) => { await taskIn(id, scope); const task = await runtime.getTask(id, { includeEvents: true }); return task ? { id: task.id, sessionId: task.sessionId, cost: task.cost, events: task.events } : notFound; }, 'logs.view'),
    route('POST', '/api/tasks/:id/messages', async ({ params: { id }, body, user, scope }) => { await taskIn(id, scope); const b = await body(ATTACHMENT_REQUEST_BYTES); const { attachments: files, ...rest } = b; const attachments = decodeAttachments(files, rest); return reply(202, await runtime.sendMessage(id, user, b.text, { permission: b.permission, context: b.context, attachments })); }, 'tasks.manage'),
    // Change a message already sent: the conversation is rewound to it and the agent answers the new text.
    route('PATCH', '/api/tasks/:id/messages/:eventId', async ({ params: { id, eventId }, body, user, scope }) => { await taskIn(id, scope); return runtime.editMessage(id, eventId, (await body()).text, user); }, 'tasks.manage'),
    route('POST', '/api/tasks/:id/cancel', async ({ params: { id }, user, scope }) => { await taskIn(id, scope); return runtime.cancel(id, user); }, 'tasks.manage'),
    // Messages waiting for the current step to finish: change the text, drop one, or send one now (interrupting the step).
    route('PATCH', '/api/tasks/:id/queue/:entry', async ({ params: { id, entry }, body, scope }) => { await taskIn(id, scope); return runtime.editQueued(id, entry, (await body()).text); }, 'tasks.manage'),
    route('DELETE', '/api/tasks/:id/queue/:entry', async ({ params: { id, entry }, scope }) => { await taskIn(id, scope); return runtime.removeQueued(id, entry); }, 'tasks.manage'),
    route('POST', '/api/tasks/:id/queue/:entry/send', async ({ params: { id, entry }, user, scope }) => { await taskIn(id, scope); return runtime.sendQueuedNow(id, entry, user); }, 'tasks.manage'),
    route('GET', '/api/tasks/:id/files', files),
    linkable(route('GET', '/api/tasks/:id/files/raw', ctx => files({ ...ctx, params: { ...ctx.params, kind: 'raw' } }))),
    route('GET', '/api/tasks/:id/files/:kind', files),
    route('GET', '/api/tasks/:id/events', events),
    // A knowledge setup task's interview guide (SPEC-knowledge-03 FR-7); any other task reads as an empty guide.
    route('GET', '/api/tasks/:id/interview-guide', async ({ params: { id }, scope }) => {
      const row = await taskIn(id, scope);
      if (!runtime.workspaces || !row?.context?.knowledgeSetup) return { questions: [], updatedAt: null };
      return readGuide(await (await runtime.workspaces.for(row.projectId)).taskDir(id));
    }),
    route('GET', '/api/inbox', async ({ url, scope }) => {
      const paged = url.searchParams.has('offset');
      const filters = { status: url.searchParams.get('status') || undefined, kind: url.searchParams.get('kind') || undefined, taskId: url.searchParams.get('taskId') || undefined, limit: paged ? pageNumber(url.searchParams.get('limit'), 10, 100, 'limit') : num(url.searchParams.get('limit'), 200) };
      if (paged) {
        const view = url.searchParams.get('view') || 'all';
        if (!['all', 'needs_action', 'done'].includes(view)) throw httpError(400, 'view must be all, needs_action, or done.');
        return taskStore.pageInbox(scope, { ...filters, view, offset: pageNumber(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER, 'offset') });
      }
      const items = await taskStore.listInbox(scope, filters);
      return { items, pending: items.filter(item => item.status === 'pending').length };
    }),
    route('POST', '/api/inbox/read-all', async ({ user, scope }) => ({ updated: await taskStore.readAllInbox(scope, actorOf(user)) }), '*'),
    // How people have decided the agent's requests, by policy category: the evidence behind "let Sonic do this without asking".
    route('GET', '/api/inbox/stats', ({ url, scope }) => approvalStats(taskStore, scope, num(url.searchParams.get('days'), 30))),
    route('POST', '/api/inbox/:id/approve', async ({ params: { id }, user, scope }) => { await itemIn(id, scope); return runtime.decideApproval(id, 'approved', user); }, 'approvals.decide'),
    route('POST', '/api/inbox/:id/deny', async ({ params: { id }, user, scope }) => { await itemIn(id, scope); return runtime.decideApproval(id, 'denied', user); }, 'approvals.decide'),
    // Answers to the agent's question: { answers: { [question]: "label" | "label, label" | "typed answer" } }.
    route('POST', '/api/inbox/:id/answer', async ({ params: { id }, body, user, scope }) => { await itemIn(id, scope); return runtime.answerQuestion(id, (await body()).answers || {}, user); }, 'approvals.decide'),
    route('POST', '/api/inbox/:id/read', async ({ params: { id }, user, scope }) => {
      const item = await itemIn(id, scope);
      if (item.kind === 'approval' && item.status === 'pending') return reply(400, { error: 'Approve or deny this item instead' });
      return taskStore.updateInboxItem(id, { status: 'read', readBy: actorOf(user) });
    }, '*'),
  ]);
}
