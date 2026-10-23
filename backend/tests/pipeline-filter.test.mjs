import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPipelines, jobFilterOf, keepsPipeline } from '../src/platform/pipeline-filter.mjs';

const pipelines = [
  { pipelineId: '731', name: 'veltrix_sales_daily_load', platform: 'databricks' },
  { pipelineId: '732', name: 'corvana_sales_daily_load', platform: 'databricks' },
  { pipelineId: '740', name: 'nbrx_weekly_refresh', platform: 'databricks' },
  { pipelineId: '745', name: 'HCP_Master_Sync', platform: 'databricks' },
  { pipelineId: 'sf-1', name: 'sales_dev_copy', platform: 'snowflake' },
];
const names = list => list.map(item => item.name);
const platform = (jobs, extra = {}) => ({ name: 'commercial-databricks', type: 'databricks', connection: 'databricks', monitoring: { jobs }, ...extra });

test('no filter, or the plugin\'s free-text jobs description, keeps every pipeline', () => {
  assert.deepEqual(filterPipelines(pipelines, []), pipelines);
  assert.deepEqual(filterPipelines(pipelines, [platform('Jobs API run history (/api/2.2/jobs/runs/list)')]), pipelines);
  assert.deepEqual(filterPipelines(pipelines, [platform({ include: [], exclude: [] })]), pipelines);
  assert.deepEqual(filterPipelines(pipelines, undefined), pipelines);
  assert.deepEqual(filterPipelines(undefined, [platform({ include: ['sales'] })]), []);
});

test('include keeps names that contain any term, case-insensitive', () => {
  const kept = filterPipelines(pipelines, [platform({ include: ['SALES', 'hcp'] })]);
  assert.deepEqual(names(kept), ['veltrix_sales_daily_load', 'corvana_sales_daily_load', 'HCP_Master_Sync', 'sales_dev_copy']);
});

test('exclude wins over include and an empty include means all jobs', () => {
  assert.deepEqual(names(filterPipelines(pipelines, [platform({ include: ['sales'], exclude: ['corvana'] })])).filter(name => name !== 'sales_dev_copy'), ['veltrix_sales_daily_load']);
  assert.deepEqual(names(filterPipelines(pipelines, [platform({ exclude: ['weekly'] })])), ['veltrix_sales_daily_load', 'corvana_sales_daily_load', 'HCP_Master_Sync', 'sales_dev_copy']);
});

test('a term equal to the pipeline id matches that pipeline', () => {
  assert.deepEqual(names(filterPipelines(pipelines, [platform({ include: ['740'] })])), ['nbrx_weekly_refresh', 'sales_dev_copy']);
});

test('filters apply only to pipelines of the platform they belong to', () => {
  const config = [platform({ include: ['nbrx'] }), { name: 'warehouse', type: 'snowflake', connection: 'snowflake', monitoring: { jobs: { exclude: ['_dev'] } } }];
  assert.deepEqual(names(filterPipelines(pipelines, config)), ['nbrx_weekly_refresh']);
});

test('two platform entries on one connection add up', () => {
  const config = [platform({ include: ['veltrix'] }), platform({ include: ['corvana'] }, { name: 'second' })];
  assert.deepEqual(names(filterPipelines(pipelines, config)), ['veltrix_sales_daily_load', 'corvana_sales_daily_load', 'sales_dev_copy']);
  // An unfiltered entry on the same connection keeps everything for that provider.
  assert.equal(filterPipelines(pipelines, [platform({ include: ['veltrix'] }), platform('free text', { name: 'other' })]).length, pipelines.length);
});

test('accepts the whole operations object and comma-separated terms', () => {
  assert.deepEqual(names(filterPipelines(pipelines, { platforms: [platform({ include: 'nbrx, hcp' })] })), ['nbrx_weekly_refresh', 'HCP_Master_Sync', 'sales_dev_copy']);
});

test('jobFilterOf and keepsPipeline', () => {
  assert.equal(jobFilterOf({ monitoring: { jobs: 'text' } }), null);
  assert.equal(jobFilterOf({}), null);
  assert.deepEqual(jobFilterOf(platform({ include: [' Sales ', ''], exclude: ['X'] })), { include: ['sales'], exclude: ['x'] });
  assert.equal(keepsPipeline(pipelines[0], null), true);
  assert.equal(keepsPipeline(pipelines[0], { include: [], exclude: ['veltrix'] }), false);
});
