import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeLines } from '../src/tasks/task-runtime.mts';

// SPEC-tasks-08 FR-7: the host produces fallback instructions when search misses.
const bases = [{ name: 'team-knowledge', description: 'Runbooks' }, { name: 'field-knowledge', description: 'Field execution' }];

for (const appTools of [true, false]) {
  test(`FR-7: a search miss falls back to the indexes and grep -R (${appTools ? 'with' : 'without'} the app tools)`, () => {
    const rule = knowledgeLines({ knowledgeBases: bases, appTools }).join('\n');
    assert.match(rule, /search finds nothing relevant/i);
    assert.match(rule, /knowledge\/index\.md/);
    assert.match(rule, /each base above whose description fits/);
    assert.match(rule, /grep -R/);
    assert.match(rule, /Grep tool/);
    assert.match(rule, /never grep -r/);
    assert.match(rule, /symlinks/);
    assert.match(rule, /indexes you opened/);
  });
}
