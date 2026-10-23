import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, ROLE_IDS, isRole, permissionsFor, projectPermissionsFor, resolveRole } from '../src/app/rbac.mjs';
import { ROLE_DEFINITIONS, RbacStore } from '../src/app/rbac-store.mjs';

test('rbac: viewer is a role the backend accepts, with no write permissions', () => {
  assert.deepEqual([...ROLE_IDS], ['admin', 'developer', 'viewer']);
  assert.equal(isRole('viewer'), true); assert.equal(isRole('member'), false);
  assert.equal(resolveRole({ id: 'v', storedRole: 'viewer' }), ROLES.VIEWER, 'a stored viewer role wins');
  assert.equal(resolveRole({ id: 'v', roles: ['viewer'] }), ROLES.VIEWER, 'an IdP viewer role resolves');
  assert.equal(resolveRole({ id: 'd', roles: ['viewer', 'developer'] }), ROLES.DEVELOPER, 'the stronger role wins');
  assert.deepEqual(permissionsFor(ROLES.VIEWER), []);
  // SPEC-projects-03 FR-2, FR-6: the app developer only adds creating projects; inside a project the project role decides.
  assert.deepEqual(permissionsFor(ROLES.DEVELOPER), ['projects.create']);
  assert.ok(projectPermissionsFor('developer').includes('tasks.manage'));
  assert.deepEqual(projectPermissionsFor('viewer'), []); assert.deepEqual(projectPermissionsFor('open'), []); assert.deepEqual(projectPermissionsFor('member'), []);
  assert.ok(projectPermissionsFor('owner').includes('project.members') && !projectPermissionsFor('developer').includes('project.members'));
  assert.equal(resolveRole({ id: 'nobody' }) === ROLES.ADMIN || resolveRole({ id: 'nobody' }) === ROLES.VIEWER, true, 'unknown people are viewers (admin only in development mode)');
  assert.ok(ROLE_DEFINITIONS.some(role => role.id === 'viewer' && role.label === 'Viewer'));
});

test('rbac store: a user can be given the viewer role, and unknown roles are rejected', async () => {
  // The store reads its files from the throwaway test root set up by tests/test-environment.mjs.
  const store = new RbacStore();
  await store.init();
  const actor = { id: 'admin', name: 'Admin' };
  await store.upsert({ id: 'priya', name: 'Priya', role: 'developer' }, actor);
  const viewer = await store.setRole('priya', 'viewer', actor);
  assert.equal(viewer.role, 'viewer');
  await assert.rejects(store.setRole('priya', 'member', actor), /Invalid role/);
  const created = await store.upsert({ id: 'ravi', name: 'Ravi', role: 'viewer' }, actor);
  assert.equal(created.role, 'viewer');
  assert.equal(resolveRole({ id: 'ravi', storedRole: created.role }), ROLES.VIEWER);
});
