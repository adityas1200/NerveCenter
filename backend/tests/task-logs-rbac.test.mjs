import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { taskRoutes } from '../src/api/task-routes.mjs';
import { authorizeRoute, permissionsFor, projectUser } from '../src/app/rbac.mjs';
import { sendError, sendJson } from '../src/lib/http.mjs';
import { dispatch } from '../src/lib/router.mjs';
import { PROJECT_HEADER, resolveScope } from '../src/projects/project-access.mjs';

const taskId = 'T-log-access';
let server;
let base;

const task = {
  id: taskId,
  projectId: 'pilot',
  sessionId: 'session-log-probe',
  cost: { totalUsd: 0 },
  events: [{ seq: 1, type: 'assistant.text', text: 'private task log' }],
};
const projectStore = {
  async memberProjectIds() { return ['pilot']; },
  async get(id) { return id === 'pilot' ? { id: 'pilot', kind: 'normal' } : null; },
  async list() { return [{ id: 'pilot', kind: 'normal' }]; },
  async memberRole(_projectId, userId) { return userId === 'logs-developer' ? 'developer' : 'viewer'; },
};
const taskStore = {
  async getTask(id) { return id === taskId ? task : null; },
  async listEvents() { return task.events; },
};
const runtime = {
  async getTask(id, { includeEvents } = {}) { return id === taskId ? (includeEvents ? task : { ...task, events: undefined }) : null; },
};

const getLogs = async (userId, role) => {
  const response = await fetch(`${base}/api/tasks/${taskId}/logs`, {
    headers: {
      'x-nervecenter-project': 'pilot',
      'x-user-id': userId,
      'x-user-role': role,
    },
  });
  return { status: response.status, body: await response.json() };
};

test.before(async () => {
  const routes = taskRoutes({ runtime, taskStore });
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const userId = String(req.headers['x-user-id'] || '');
      const role = String(req.headers['x-user-role'] || 'viewer');
      const user = { id: userId, name: userId, role, permissions: permissionsFor(role) };
      const handled = await dispatch(routes, {
        req,
        res,
        url,
        p: url.pathname.split('/').filter(Boolean),
        m: req.method,
        user,
        scopeUser: scope => projectUser(user, scope),
        resolveScope: entry => resolveScope({ store: projectStore, user, header: req.headers[PROJECT_HEADER], scopeClass: entry.scope, method: req.method }),
        authorize: (needs, method, actor, scope) => authorizeRoute(actor, method, needs, scope),
      });
      if (!handled) sendJson(res, 404, { error: 'Route not found' });
    } catch (error) {
      sendError(res, error?.statusCode || 500, error);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise(resolve => server.close(resolve)));

test('FR-26 task logs require app admin permission in addition to project access', async () => {
  for (const [userId, role] of [['logs-developer', 'developer'], ['logs-viewer', 'viewer']]) {
    const denied = await getLogs(userId, role);
    assert.equal(denied.status, 403, `${role} cannot read task logs`);
  }

  const allowed = await getLogs('logs-admin', 'admin');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.id, taskId);
  assert.equal(allowed.body.sessionId, 'session-log-probe');
  assert.equal(allowed.body.events[0].text, 'private task log');
});
