import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FileProjectPersistence, ProjectStore } from '../src/projects/project-store.mjs';
import { GrantService } from '../src/projects/grant-service.mjs';
import { tempDir } from './helpers.mjs';

// SPEC-projects-01 FR-26, FR-27, FR-31, FR-32: connection grants, overlap rejection and routing.
const ADMIN = { id: 'admin', role: 'admin' };
const profiles = { 'snow-main': { id: 'snow-main', provider: 'servicenow' }, 'snow-old': { id: 'snow-old', provider: 'servicenow' }, 'jira-main': { id: 'jira-main', provider: 'jira' }, smtp: { id: 'smtp', provider: 'smtp' } };

async function setup() {
  const projects = new ProjectStore({ persistence: new FileProjectPersistence(path.join(await tempDir('grants'), 'projects.json')) });
  for (const id of ['sales', 'finance']) await projects.create({ id, name: id }, ADMIN);
  const grants = new GrantService({ projects, workspaces: null, connections: { store: { get: async id => profiles[id] || null } } });
  return { projects, grants };
}
const snow = group => ({ metadata: { serviceNow: { assignmentGroup: group } } });

test('FR-31, FR-27: grants are stored with a cleaned filter, and an overlapping filter on the same connection is refused', async () => {
  const { projects, grants } = await setup();
  await grants.grant('sales', { resourceType: 'connection', resourceId: 'snow-main', scope: { assignmentGroups: ['Sales Ops', 'sales ops', ''] } }, ADMIN);
  assert.deepEqual((await projects.listGrants('sales', 'connection'))[0].scope, { assignmentGroups: ['Sales Ops'] });
  await assert.rejects(grants.grant('finance', { resourceType: 'connection', resourceId: 'snow-main', scope: { assignmentGroups: ['SALES OPS'] } }, ADMIN), /overlaps sales/);
  await assert.rejects(grants.grant('finance', { resourceType: 'connection', resourceId: 'snow-main', scope: {} }, ADMIN), /overlaps/);
  await grants.grant('finance', { resourceType: 'connection', resourceId: 'snow-main', scope: { assignmentGroups: ['Finance'] } }, ADMIN);
  await assert.rejects(grants.grant('sales', { resourceType: 'connection', resourceId: 'nope' }, ADMIN), /not found/);
  await assert.rejects(grants.grant('sales', { resourceType: 'printer', resourceId: 'x' }, ADMIN), /resourceType/);
});

test('FR-32: one default connection per provider per project', async () => {
  const { projects, grants } = await setup();
  await grants.grant('sales', { resourceType: 'connection', resourceId: 'snow-old', isDefault: true }, ADMIN);
  await grants.grant('sales', { resourceType: 'connection', resourceId: 'jira-main', isDefault: true }, ADMIN);
  await grants.grant('sales', { resourceType: 'connection', resourceId: 'snow-main', isDefault: true }, ADMIN);
  const byId = Object.fromEntries((await projects.listGrants('sales', 'connection')).map(grant => [grant.resourceId, grant.isDefault]));
  assert.deepEqual(byId, { 'snow-old': false, 'jira-main': true, 'snow-main': true });
});

test('FR-26: imported items route by grant filter; no match or no holder goes to unrouted; revoke stops routing', async () => {
  const { grants } = await setup();
  assert.equal((await grants.route('snow-main', 'servicenow', snow('Sales Ops'))).projectId, 'unrouted');
  await grants.grant('sales', { resourceType: 'connection', resourceId: 'snow-main', scope: { assignmentGroups: ['Sales Ops'] } }, ADMIN);
  await grants.grant('finance', { resourceType: 'connection', resourceId: 'snow-main', scope: { assignmentGroups: ['Finance'] } }, ADMIN);
  assert.equal((await grants.route('snow-main', 'servicenow', snow('sales ops'))).projectId, 'sales');
  assert.equal((await grants.route('snow-main', 'servicenow', snow('Finance'))).projectId, 'finance');
  assert.equal((await grants.route('snow-main', 'servicenow', snow('HR'))).projectId, 'unrouted');
  await grants.revoke('finance', 'connection', 'snow-main', ADMIN);
  assert.equal((await grants.route('snow-main', 'servicenow', snow('Finance'))).projectId, 'unrouted');
  await assert.rejects(grants.revoke('finance', 'connection', 'snow-main', ADMIN), /no grant/);
});

test('FR-26: a connection without a routing filter routes to its only holder', async () => {
  const { grants } = await setup();
  await grants.grant('sales', { resourceType: 'connection', resourceId: 'smtp' }, ADMIN);
  assert.equal((await grants.route('smtp', 'smtp', {})).projectId, 'sales');
});
