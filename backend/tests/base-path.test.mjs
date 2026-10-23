import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBasePath, stripBasePath } from '../src/lib/base-path.mjs';

test('base path: normalised to a single leading slash, or empty', () => {
  assert.equal(normalizeBasePath(''), '');
  assert.equal(normalizeBasePath(undefined), '');
  assert.equal(normalizeBasePath('/'), '');
  assert.equal(normalizeBasePath('apps/nervecenter/'), '/apps/nervecenter');
  assert.equal(normalizeBasePath(' /apps/nervecenter '), '/apps/nervecenter');
});

test('base path: stripped when present, left alone when absent, never matches a longer sibling', () => {
  const base = '/apps/nervecenter';
  assert.equal(stripBasePath('/apps/nervecenter/api/tickets', base), '/api/tickets');
  assert.equal(stripBasePath('/apps/nervecenter/health', base), '/health');
  assert.equal(stripBasePath('/apps/nervecenter', base), '/');
  assert.equal(stripBasePath('/api/tickets', base), '/api/tickets');
  assert.equal(stripBasePath('/apps/nervecenter-other/api', base), '/apps/nervecenter-other/api');
  assert.equal(stripBasePath('/api/tickets', ''), '/api/tickets');
});
