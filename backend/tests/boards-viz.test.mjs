import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { BoardService, CHART_KINDS, NERVECENTER_SOURCES, normaliseBoard } from '../src/boards/board-service.mjs';
import { tempDir, pilot } from './helpers.mjs';

// SPEC-boards-02 FR-2 (pipelines.runs, pipelines.failures_by_day), FR-12, FR-13, FR-14.
const tmp = await tempDir('nc-boards-viz-');
const builder = { id: 'priya', name: 'Priya Nair', role: 'developer' };
const clock = () => Date.parse('2026-09-25T10:00:00Z');
const run = (pipelineId, startTime, status, endTime = null) => ({ runId: `${pipelineId}-${startTime.slice(8, 13)}`, pipelineId, platform: 'databricks', status, startTime, endTime });
const fakeOps = {
  async monitor() {
    return {
      items: [
        { pipelineId: '731', name: 'veltrix_sales_daily_load', platform: 'databricks', health: 'failed' },
        { pipelineId: '755', name: 'payer_formulary_load', platform: 'databricks', health: 'running' },
      ],
      recentRuns: [
        run('731', '2026-09-25T04:00:00Z', 'failed', '2026-09-25T04:06:00Z'),
        run('731', '2026-09-25T05:00:00Z', 'failed', '2026-09-25T05:02:00Z'),
        run('731', '2026-09-24T04:00:00Z', 'healthy', '2026-09-24T04:21:00Z'),
        run('755', '2026-09-25T09:40:00Z', 'running'),
        run('755', '2026-09-23T09:40:00Z', 'failed', '2026-09-23T09:41:00Z'),
        run('999', '2026-09-25T01:00:00Z', 'failed', '2026-09-25T01:01:00Z'),
      ],
    };
  },
};
async function service() {
  const store = new FileOperationsStore(path.join(tmp, `ops-${Math.random().toString(36).slice(2, 8)}`)); await store.init();
  return new BoardService({ store, operationsService: fakeOps, clock });
}
const widgetOf = (type, viz) => normaliseBoard({ title: 'b', widgets: [{ type, title: 'w', source: { query: 'pipelines.health' }, viz }] }).widgets[0];

test('FR-12: heatmap, funnel and gantt charts keep only the fields their kind draws with', () => {
  assert.deepEqual(CHART_KINDS.slice(-3), ['heatmap', 'funnel', 'gantt']);
  const heat = widgetOf('chart', { chart: 'heatmap', xColumn: 'Pipeline', seriesColumns: Array.from({ length: 70 }, (_, index) => `d${index}`), scale: 'high_is_bad', unit: 'runs', pivotColumn: 'Day', startColumn: 'ignored' });
  assert.equal(heat.viz.scale, 'high_is_bad'); assert.equal(heat.viz.unit, 'runs'); assert.equal(heat.viz.pivotColumn, 'Day');
  assert.equal(heat.viz.seriesColumns.length, 62, 'a heatmap takes up to 62 columns');
  assert.equal(heat.viz.startColumn, undefined, 'gantt fields are dropped from a heatmap');
  assert.equal(widgetOf('chart', { chart: 'heatmap', scale: 'loud' }).viz.scale, 'neutral');
  const gantt = widgetOf('chart', { chart: 'gantt', xColumn: 'Pipeline', startColumn: 'Started', endColumn: 'Ended', stateColumn: 'Status', labelColumn: 'Run', scale: 'high_is_bad' });
  assert.deepEqual([gantt.viz.startColumn, gantt.viz.endColumn, gantt.viz.stateColumn, gantt.viz.labelColumn, gantt.viz.scale], ['Started', 'Ended', 'Status', 'Run', undefined]);
  assert.equal(widgetOf('chart', { chart: 'funnel', seriesColumns: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).viz.seriesColumns.length, 6);
});

test('FR-13: a metric gauge needs a positive max; the target is optional and higher is better by default', () => {
  assert.deepEqual(widgetOf('metric', { gauge: { max: 100, target: 95 } }).viz.gauge, { max: 100, target: 95, higherIsBetter: true });
  assert.deepEqual(widgetOf('metric', { gauge: { max: '72', higherIsBetter: false } }).viz.gauge, { max: 72, target: null, higherIsBetter: false });
  assert.equal(widgetOf('metric', { gauge: { max: 0, target: 1 } }).viz.gauge, undefined);
  assert.equal(widgetOf('metric', { gauge: 'big' }).viz.gauge, undefined);
  assert.equal(widgetOf('chart', { gauge: { max: 100 } }).viz.gauge, undefined, 'only metrics draw a ring');
});

test('FR-14: a widget saved before these fields reads back unchanged', () => {
  const old = widgetOf('chart', { chart: 'column', xColumn: 'Period', seriesColumns: ['Succeeded', 'Failed'] });
  assert.deepEqual(old.viz, { chart: 'column', xColumn: 'Period', seriesColumns: ['Succeeded', 'Failed'], layout: 'stacked', showValues: false });
  assert.deepEqual(Object.keys(widgetOf('metric', {}).viz).sort(), ['labelColumn', 'suffix', 'tone', 'valueColumn']);
});

test('FR-2: pipelines.runs lists the runs of known pipelines newest first, with state words and both times', async () => {
  const boards = await service();
  assert.ok(NERVECENTER_SOURCES.some(source => source.id === 'pipelines.runs' && source.fits.includes('chart')));
  const result = await boards.preview({ type: 'chart', title: 'Runs', source: { query: 'pipelines.runs' }, viz: { chart: 'gantt' } }, { range: '7d' }, builder, null, pilot);
  assert.deepEqual(result.columns, ['Pipeline', 'Run', 'Status', 'Started', 'Ended']);
  assert.deepEqual(result.rows.map(row => [row[0], row[2], row[3], row[4]]), [
    ['payer_formulary_load', 'Running', '2026-09-25T09:40:00Z', null],
    ['veltrix_sales_daily_load', 'Failed', '2026-09-25T05:00:00Z', '2026-09-25T05:02:00Z'],
    ['veltrix_sales_daily_load', 'Failed', '2026-09-25T04:00:00Z', '2026-09-25T04:06:00Z'],
    ['veltrix_sales_daily_load', 'Succeeded', '2026-09-24T04:00:00Z', '2026-09-24T04:21:00Z'],
    ['payer_formulary_load', 'Failed', '2026-09-23T09:40:00Z', '2026-09-23T09:41:00Z'],
  ], 'a run of a pipeline outside the list (999) is left out');
  const matched = await boards.preview({ type: 'table', title: 'Runs', source: { query: 'pipelines.runs', params: { match: 'payer' } } }, { range: '7d' }, builder, null, pilot);
  assert.deepEqual([...new Set(matched.rows.map(row => row[0]))], ['payer_formulary_load']);
});

test('FR-2: pipelines.failures_by_day is one row per failing pipeline and one column per bucket, worst first', async () => {
  const boards = await service();
  const result = await boards.preview({ type: 'chart', title: 'Fails', source: { query: 'pipelines.failures_by_day' }, viz: { chart: 'heatmap', scale: 'high_is_bad' } }, { range: '7d' }, builder, null, pilot);
  assert.equal(result.columns[0], 'Pipeline');
  assert.ok(result.columns.length >= 8, 'one column per day of the week');
  assert.deepEqual(result.rows.map(row => [row[0], row.slice(1).reduce((sum, value) => sum + value, 0)]), [['veltrix_sales_daily_load', 2], ['payer_formulary_load', 1]]);
  const day = result.columns.indexOf('09/25');
  assert.equal(result.rows[0][day], 2, 'both Veltrix failures land on 25 Sep');
});
