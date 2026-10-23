import test from 'node:test';
import assert from 'node:assert/strict';
import { plainError } from '../src/boards/board-service.mjs';

test('board widget errors redact provider credentials before reaching readers', () => {
  const message = plainError(new Error('Provider failed: password=fake-value token=fake-token'));
  assert.equal(message, 'Provider failed: password [redacted] token [redacted]');
  assert.equal(message.includes('fake-value'), false);
  assert.equal(message.includes('fake-token'), false);
});
