import test from 'node:test';
import assert from 'node:assert/strict';
import { TicketTaskService } from '../src/tasks/ticket-tasks.mjs';

// SPEC-projects-01 FR-39: the ticket poller runs once per active project, with that project's sources and scope.
test('FR-39: the ticket poller polls each active project with its own sources and scope', async () => {
  const calls = [];
  const sources = { sales: [{ platform: 'servicenow', filters: { group: 'Sales' } }], finance: [{ platform: 'jira', filters: { jql: 'project = FIN' } }] };
  const projects = { list: async () => [{ id: 'sales', kind: 'normal' }, { id: 'finance', kind: 'normal' }, { id: 'old', kind: 'normal', archivedAt: '2026-01-01' }, { id: 'unrouted', kind: 'unrouted' }] };
  const workspaces = { for: async id => ({ readOperations: async () => ({ ticketing: { sources: sources[id] || [] } }) }) };
  const operationsService = {
    syncServiceNow: async ({ scope, ...filters }) => { calls.push(['servicenow', scope.projectId, filters.group]); return { tickets: [] }; },
    syncJira: async ({ scope, ...filters }) => { calls.push(['jira', scope.projectId, filters.jql]); return { tickets: [] }; },
  };
  const service = new TicketTaskService({ store: {}, runtime: null, operationsService, workspace: null, projects, workspaces });
  const result = await service.poll({ force: true });
  assert.deepEqual(calls, [['servicenow', 'sales', 'Sales'], ['jira', 'finance', 'project = FIN']]);
  assert.deepEqual(Object.keys(result.projects), ['sales', 'finance']);
});
