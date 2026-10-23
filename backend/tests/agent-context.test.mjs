import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { knowledgeLines } from '../src/tasks/task-runtime.mjs';
import { makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

// SPEC-tasks-08: what the agent is told about skills and knowledge when a session starts.
const tmp = await tempDir('nc-agent-context-');
const user = { id: 'mitesh', name: 'Mitesh' };

function recordingSdk(skills) {
  const calls = [];
  return { calls, query: ({ options }) => { calls.push(options); return (async function* () { yield sdkInit(`s-${calls.length}`, { skills }); yield sdkResult(`s-${calls.length}`, 'Done.'); })(); } };
}
const writeFile = async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text, 'utf8'); };

test('FR-1: session.init lists plugin skills and the project\'s own skills, not built-in ones', async () => {
  const sdk = recordingSdk(['operations-fleet:rca', 'sales-kpis', 'margin-check', 'update-config']);
  const { runtime, store, workspace } = await makeRuntime(tmp, sdk, { name: 'skills' });
  await writeFile(path.join(workspace.skillsDir, 'sales-kpis', 'SKILL.md'), '---\nname: sales-kpis\ndescription: KPI rules\n---\n# Sales KPIs\n');
  // The SDK may report a skill by its frontmatter name rather than its folder.
  await writeFile(path.join(workspace.skillsDir, 'margins', 'SKILL.md'), '---\nname: margin-check\ndescription: Margin rules\n---\n# Margins\n');
  const task = await runtime.startTask({ scope: pilot, prompt: 'hello', user, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'done');
  const init = (await runtime.getTask(task.id, { includeEvents: true })).events.find(event => event.type === 'session.init');
  assert.deepEqual(init.skills, ['operations-fleet:rca']);
  assert.deepEqual(init.projectSkills, ['sales-kpis', 'margin-check']);
});

test('FR-3 to FR-5: the system prompt carries the knowledge map, knowledge-first and unslop', async () => {
  const sdk = recordingSdk([]);
  const { runtime, store, workspace } = await makeRuntime(tmp, sdk, { name: 'knowledge' });
  await writeFile(path.join(workspace.knowledgeDir, 'platform-runbooks', 'index.md'), '---\ntitle: Platform runbooks\ndescription: How to restart and repair jobs\n---\n');
  await writeFile(path.join(workspace.knowledgeDir, 'kpi-definitions', 'index.md'), '---\ntitle: KPI definitions\ndescription: What each metric means\n---\n');
  const task = await runtime.startTask({ scope: pilot, prompt: 'hello', user, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'done');
  const append = sdk.calls[0].systemPrompt.append;
  assert.match(append, /## Knowledge map/);
  assert.match(append, /- platform-runbooks \(Platform runbooks\): How to restart and repair jobs/);
  assert.match(append, /- kpi-definitions \(KPI definitions\): What each metric means/);
  assert.match(append, /Knowledge first: before you propose or make a fix, pull or query data/);
  assert.match(append, /even on the orchestrator's fast path/);
  assert.match(append, /quick questions about current state/);
  assert.match(append, /load the operations-fleet:unslop skill with the Skill tool once/);
  // FR-6: without NerveCenter's tools the rule points at the files instead of search_knowledge.
  assert.match(append, /open knowledge\/index\.md and Grep knowledge\//);
});

test('FR-3: a project without knowledge is told so', async () => {
  const sdk = recordingSdk([]);
  const { runtime, store, workspace } = await makeRuntime(tmp, sdk, { name: 'empty' });
  await fs.rm(workspace.knowledgeDir, { recursive: true, force: true });
  const task = await runtime.startTask({ scope: pilot, prompt: 'hello', user, notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'done');
  assert.match(sdk.calls[0].systemPrompt.append, /No knowledge bases are connected to this project\./);
});

test('FR-3, FR-6: the map is capped, lines are short, and with app tools the rule names search_knowledge', () => {
  const many = Array.from({ length: 45 }, (_, n) => ({ name: `base-${n}`, title: `base-${n}`, description: 'x'.repeat(400) }));
  const lines = knowledgeLines({ knowledgeBases: many, appTools: true });
  const listed = lines.filter(line => line.startsWith('- base-'));
  assert.equal(listed.length, 40);
  assert.ok(listed.every(line => line.length <= 200));
  assert.ok(lines.includes('- …and 5 more in knowledge/index.md'));
  assert.match(lines.join('\n'), /call search_knowledge for the subject \(knowledge_catalog when the search finds nothing useful\)/);
});
