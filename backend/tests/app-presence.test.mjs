import test from 'node:test';
import assert from 'node:assert/strict';
import { AppPresence } from '../src/app/app-presence.mjs';

test('app presence becomes idle when visible-browser heartbeats stop', () => {
  let time = Date.parse('2026-09-28T09:00:00Z');
  const presence = new AppPresence({ idleSeconds: 90, clock: () => time });

  assert.equal(presence.isActive(), false);
  assert.equal(presence.touch().active, true);
  time += 90_000;
  assert.equal(presence.isActive(), true, 'the full grace period remains active');
  time += 1;
  assert.equal(presence.isActive(), false);
});

test('a zero idle timeout keeps background polling enabled', () => {
  assert.equal(new AppPresence({ idleSeconds: 0 }).isActive(), true);
});
