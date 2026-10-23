import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { z } from 'zod';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { OperationsService } from '../src/app/operations-service.mjs';
import { createAppTools } from '../src/tasks/nervecenter-tools.mjs';
import { TOOL_CATEGORIES } from '../src/tasks/nervecenter-tool-categories.mjs';
import { classifyTool } from '../src/tasks/permission-policy.mjs';
import { COMPONENT_TOOLS, catalogPromptLines } from '../src/tasks/ui-catalog.mjs';
import { fakeMcpSdk, tempDir } from './helpers.mjs';

// SPEC-tasks-10 FR-25: heatmap, gauges, funnel, gantt, the donut chart and metric trends.
const tmp = await tempDir('nc-ui-viz-');
const ops = new FileOperationsStore(path.join(tmp, 'ops')); await ops.init();
const server = createAppTools({ operationsService: new OperationsService({ store: ops }), taskStore: new FileTaskStore(path.join(tmp, 'store')) })({ id: 'T-1', projectId: 'pilot', createdBy: { id: 'u', name: 'U' } }, fakeMcpSdk);
const raw = async (tool, args) => server.tools.find(item => item.name === tool).handler(args);
const parse = (tool, args) => z.object(COMPONENT_TOOLS[tool].shape).safeParse(args);

test('FR-25: the new visualisations are read tools that run read-only, listed in the prompt and allowed in a view', async () => {
  const offered = new Set(server.tools.map(tool => tool.name));
  const lines = catalogPromptLines().join('\n');
  for (const tool of ['show_heatmap', 'show_gauges', 'show_funnel', 'show_gantt']) {
    assert.ok(offered.has(tool), `${tool} is offered`);
    assert.equal(TOOL_CATEGORIES[tool], 'read');
    assert.equal(classifyTool(`mcp__nervecenter__${tool}`, {}, { permission: 'read-only' }).verdict, 'allow');
    assert.match(lines, new RegExp(`- ${tool}: `));
  }
  assert.equal(parse('show_view', { title: 'Health', blocks: [
    { kind: 'heatmap', title: 'Fails', columns: ['Mon'], rows: [{ label: 'a', values: [1] }] },
    { kind: 'gauges', items: [{ label: 'SLA', value: 90, max: 100, target: 95 }] },
    { kind: 'funnel', title: 'Rows', stages: [{ label: 'In', value: 2 }, { label: 'Out', value: 1 }] },
    { kind: 'gantt', title: 'Runs', lanes: [{ label: 'job', bars: [{ start: '2026-10-11T08:00:00Z' }] }] },
  ] }).success, true);
});

test('FR-25: each refuses what it cannot draw with a message Sonic can act on', async () => {
  assert.deepEqual(await server.call('show_heatmap', { title: 'Fails', columns: ['Mon', 'Tue'], rows: [{ label: 'a', values: [1, null] }], scale: 'high_is_bad' }), { shown: true, title: 'Fails', rows: 1, columns: 2 });
  assert.match((await raw('show_heatmap', { title: 'Fails', columns: ['Mon', 'Tue'], rows: [{ label: 'a', values: [1] }] })).content[0].text, /one value \(or null\) per column/);
  assert.equal(parse('show_gauges', { items: [{ label: 'SLA', value: 90, max: 0 }] }).success, false, 'max must be positive');
  assert.equal(parse('show_funnel', { title: 'Rows', stages: [{ label: 'In', value: 2 }] }).success, false, 'a funnel needs two stages');
  assert.deepEqual(await server.call('show_gantt', { title: 'Runs', lanes: [{ label: 'job', bars: [{ start: '2026-10-11T08:00:00Z', end: '2026-10-11T08:20:00Z', state: 'failed' }] }], markers: [{ at: '2026-10-11T09:30:00Z', label: 'SLA' }] }), { shown: true, title: 'Runs', lanes: 1, bars: 1 });
  assert.match((await raw('show_gantt', { title: 'Runs', lanes: [{ label: 'job', bars: [{ start: 'yesterday' }] }] })).content[0].text, /use an ISO timestamp/);
  assert.match((await raw('show_gantt', { title: 'Runs', lanes: [{ label: 'job', bars: [{ start: '2026-10-11T09:00:00Z', end: '2026-10-11T08:00:00Z' }] }] })).content[0].text, /ends before it starts/);
  assert.equal(parse('show_chart', { title: 'Causes', type: 'donut', labels: ['a', 'b'], series: [{ name: 'n', values: [1, 2] }] }).success, true);
  assert.equal(parse('show_metrics', { items: [{ label: 'Fails', value: 3, trend: [1, 2, 3] }] }).success, true);
});
