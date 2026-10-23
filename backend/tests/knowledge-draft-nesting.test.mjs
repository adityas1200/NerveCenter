import test from 'node:test';
import assert from 'node:assert/strict';
import { insertUnderSection } from '../src/knowledge/knowledge-drafts.mjs';

// Found in a live run: a section added under "Late file" landed inside an earlier draft block,
// because that block's own heading was taken as the end of "Late file".

test('a new draft is never placed inside an earlier draft block', () => {
  const page = [
    '# Pipeline failures', '', '## Late file', '', 'Rerun later.', '',
    '<!-- draft source=OPS-101 updated=2026-09-30 -->', '## Schema change', '', 'Add the column.', '<!-- /draft -->', '',
  ].join('\n');
  const out = insertUnderSection(page, '## Late file', '<!-- draft source=OPS-103 -->\n## Expired secret\n<!-- /draft -->');
  const lines = out.split('\n');
  const first = lines.indexOf('<!-- draft source=OPS-101 updated=2026-09-30 -->');
  const added = lines.indexOf('## Expired secret');
  assert.ok(added > lines.indexOf('Rerun later.') && added < first, 'the new section sits after "Late file" and before the earlier draft');
  assert.equal(lines[first + 1], '## Schema change', 'the earlier draft block is intact');
  // Every draft opened is closed before the next one opens.
  let open = false;
  for (const line of lines) {
    if (/^<!-- draft\b/.test(line)) { assert.equal(open, false, 'no draft opens inside another'); open = true; }
    if (/^<!-- \/draft -->/.test(line)) { assert.equal(open, true); open = false; }
  }
  assert.equal(open, false);
});
