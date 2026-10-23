import test from 'node:test';
import assert from 'node:assert/strict';
import { JiraService, terminalRank } from '../src/connectors/jira/jira-service.mjs';

// Jira's "done" status category holds every terminal status: Done sits in it beside Cancelled,
// Won't Do and Duplicate. Resolving a ticket used to take whichever the workflow listed first,
// which cancelled tickets in any project whose workflow puts Cancelled before Done.

const done = (id, name) => ({ id, name: `${name} transition`, to: { name, statusCategory: { key: 'done' } } });
const progress = (id, name) => ({ id, name, to: { name, statusCategory: { key: 'indeterminate' } } });

/** A Jira that answers the transitions list, and remembers which transition was posted. */
function fakeJira(transitions) {
  const posted = [];
  const fetchFn = async (url, init = {}) => {
    const path = String(url);
    if (init.method === 'POST' && path.includes('/transitions')) { posted.push(JSON.parse(init.body).transition.id); return new Response(null, { status: 204 }); }
    if (path.includes('/transitions')) return new Response(JSON.stringify({ transitions }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const service = new JiraService({ fetchFn, secretStore: { get: async () => JSON.stringify({ apiToken: 'jira-token' }) }, connectionService: { getDefault: async () => ({ id: 'jira-1', config: { site: 'https://company.atlassian.net', email: 'me@company.com' } }), getRaw: async () => ({ id: 'jira-1', secretRef: 'connections/jira-1/credentials' }) } });
  return { service, posted };
}

test('resolving a ticket lands on Done even when the workflow lists Cancelled first', async () => {
  const { service, posted } = fakeJira([done('31', 'Cancelled'), done('41', 'Done')]);
  assert.equal(await service.transitionTo('DATAOPS-1854', 'done', 'resolved'), 'Done');
  assert.deepEqual(posted, ['41']);
});

test('cancelling a ticket still lands on Cancelled even when Done comes first', async () => {
  const { service, posted } = fakeJira([done('41', 'Done'), done('31', 'Cancelled')]);
  assert.equal(await service.transitionTo('DATAOPS-1854', 'done', 'cancelled'), 'Cancelled');
  assert.deepEqual(posted, ['31']);
});

test('closing a ticket is finishing it, not abandoning it', async () => {
  const { service } = fakeJira([done('11', "Won't Do"), done('12', 'Duplicate'), done('13', 'Resolved')]);
  assert.equal(await service.transitionTo('DATAOPS-1', 'done', 'closed'), 'Resolved');
});

test('a transition Jira marks unavailable is skipped in favour of one that is', async () => {
  const { service, posted } = fakeJira([{ ...done('41', 'Done'), isAvailable: false }, done('31', 'Cancelled')]);
  assert.equal(await service.transitionTo('DATAOPS-1', 'done', 'resolved'), 'Cancelled', 'the only available terminal status is taken');
  assert.deepEqual(posted, ['31']);
});

test('a workflow with only unrecognised terminal statuses keeps its own order', async () => {
  const { service } = fakeJira([done('51', 'Parked'), done('52', 'Archived')]);
  assert.equal(await service.transitionTo('DATAOPS-1', 'done', 'resolved'), 'Parked');
});

test('the other status categories are untouched: the first match still wins', async () => {
  const { service, posted } = fakeJira([progress('21', 'In Progress'), progress('22', 'In Review')]);
  assert.equal(await service.transitionTo('DATAOPS-1', 'indeterminate', 'in_progress'), 'In Progress');
  assert.deepEqual(posted, ['21']);
});

test('a workflow with no transition into the wanted category says so', async () => {
  const { service } = fakeJira([progress('21', 'In Progress')]);
  await assert.rejects(service.transitionTo('DATAOPS-1', 'done', 'resolved'), /no transition to a Done status for DATAOPS-1/);
});

test('the name that decides is the target status, or the transition when the status says nothing', () => {
  assert.equal(terminalRank({ to: { name: 'Done' } }, false), 2);
  assert.equal(terminalRank({ to: { name: 'Done' } }, true), 0);
  assert.equal(terminalRank({ to: { name: 'Cancelled' } }, true), 2);
  assert.equal(terminalRank({ to: { name: 'Finished' }, name: 'Cancel this' }, false), 0, 'an abandoning transition name outweighs a hopeful status');
  assert.equal(terminalRank({ to: { name: 'Parked' } }, false), 1);
  assert.equal(terminalRank({ name: 'Resolve issue' }, false), 2, 'the transition name is read when the status is not');
  // "Won't Do" must not read as "Do"; "Duplicate" and "Rejected" are abandonment, not completion.
  for (const name of ["Won't Do", 'Wont fix', 'Duplicate', 'Rejected', 'Declined', 'Invalid']) assert.equal(terminalRank({ to: { name } }, false), 0, `${name} is not a resolution`);
  for (const name of ['Done', 'Resolved', 'Complete', 'Closed', 'Fixed', 'Shipped']) assert.equal(terminalRank({ to: { name } }, false), 2, `${name} is a resolution`);
});
