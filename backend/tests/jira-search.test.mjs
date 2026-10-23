import test from 'node:test';
import assert from 'node:assert/strict';
import { JiraService } from '../src/connectors/jira/jira-service.mjs';

/**
 * /rest/api/3/search/jql caps a single request at 100 issues and paginates by opaque
 * nextPageToken/isLast, not startAt/total. searchIssues must page through it to honor a
 * caller's `limit` above 100, while staying safe against Atlassian's documented bug where
 * isLast can fail to ever turn true and nextPageToken cycles without making progress.
 */

const connectionService = { async getDefault() { return { id: 'jira-1' }; }, async getRaw() { return { secretRef: 'jira-secret' }; } };
const secretStore = { async get() { return JSON.stringify({ apiToken: 'token' }); } };
const settingsOverride = { site: 'https://example.atlassian.net', email: 'bot@example.com', project: 'OPS', secretRef: 'jira-secret' };

function service(fetchFn) {
  const svc = new JiraService({ connectionService, secretStore, fetchFn });
  svc.settings = async () => ({ mode: 'live', ...settingsOverride });
  return svc;
}

const page = (keys, { isLast, nextPageToken } = {}) => ({
  status: 200, ok: true,
  text: async () => JSON.stringify({
    issues: keys.map((key, i) => ({ id: String(1000 + i), key, fields: { summary: `Issue ${key}`, status: { name: 'To Do', statusCategory: { key: 'new' } } } })),
    isLast, nextPageToken,
  }),
});

test('a single page under the limit returns without a second request', async () => {
  const calls = [];
  const svc = service(async (_url, init) => { calls.push(JSON.parse(init.body)); return page(['OPS-1', 'OPS-2'], { isLast: true }); });
  const result = await svc.searchIssues({ limit: 50 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].maxResults, 50);
  assert.equal(result.incidents.length, 2);
  assert.equal(result.total, 2);
});

test('a limit above 100 pages through multiple 100-at-a-time requests using nextPageToken', async () => {
  const calls = [];
  let n = 0;
  const svc = service(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body); n += 1;
    if (n === 1) { assert.equal(body.maxResults, 100); assert.equal(body.nextPageToken, undefined); return page(Array.from({ length: 100 }, (_, i) => `OPS-${i}`), { isLast: false, nextPageToken: 'tok-2' }); }
    if (n === 2) { assert.equal(body.nextPageToken, 'tok-2'); assert.equal(body.maxResults, 50); return page(Array.from({ length: 50 }, (_, i) => `OPS-${100 + i}`), { isLast: false, nextPageToken: 'tok-3' }); }
    throw new Error('should not need a third page for a limit of 150');
  });
  const result = await svc.searchIssues({ limit: 150 });
  assert.equal(calls.length, 2);
  assert.equal(result.incidents.length, 150);
  assert.equal(result.total, 150);
});

test('stops as soon as Jira says isLast, even short of the requested limit', async () => {
  const svc = service(async () => page(['OPS-1', 'OPS-2', 'OPS-3'], { isLast: true, nextPageToken: 'ignored-once-last' }));
  const result = await svc.searchIssues({ limit: 2000 });
  assert.equal(result.incidents.length, 3);
});

test('a page repeating the same nextPageToken stops instead of looping forever (the documented Atlassian bug)', async () => {
  const calls = [];
  const svc = service(async (_url, init) => { calls.push(JSON.parse(init.body)); return page(['OPS-1'], { isLast: false, nextPageToken: 'stuck-token' }); });
  const result = await svc.searchIssues({ limit: 2000 });
  // First call has no token; the response always offers the same "stuck-token" next - must stop after the repeat, not loop.
  assert.ok(calls.length <= 2, `expected the stuck token to stop pagination quickly, made ${calls.length} calls`);
  assert.equal(result.incidents.length, calls.length);
});

test('an empty page stops pagination rather than requesting forever', async () => {
  const calls = [];
  const svc = service(async (_url, init) => { calls.push(JSON.parse(init.body)); return page([], { isLast: false, nextPageToken: 'tok' }); });
  const result = await svc.searchIssues({ limit: 2000 });
  assert.equal(calls.length, 1);
  assert.equal(result.incidents.length, 0);
});
