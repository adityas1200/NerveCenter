import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabricksOperationsService } from '../src/connectors/databricks/databricks-service.mjs';

// A SQL statement may run for a bounded time. When the time runs out Databricks must stop it, so a slow
// board or data quality query never keeps holding the warehouse after the app has told the reader it failed.

/** A stand-in workspace answering the Statement Execution API with a scripted state per call. */
async function fakeWarehouse({ created, polls = [] } = {}) {
  const calls = { submitted: [], polled: 0, cancelled: [] };
  const server = createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const json = payload => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
      if (req.method === 'POST' && req.url === '/api/2.0/sql/statements') { calls.submitted.push(JSON.parse(body)); return json(created); }
      if (req.method === 'POST' && /\/cancel$/.test(req.url)) { calls.cancelled.push(req.url); return json({}); }
      if (req.method === 'GET') { const next = polls[Math.min(calls.polled, polls.length - 1)]; calls.polled += 1; return json(next); }
      res.writeHead(404); res.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const service = new DatabricksOperationsService({ host: `http://127.0.0.1:${server.address().port}`, token: 'dapi-test' });
  return { service, calls, close: () => server.close() };
}

const done = { statement_id: 's-1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'rows_loaded' }] } }, result: { data_array: [[500]] } };

test('a statement asks Databricks to cancel it when the wait runs out, and returns rows when it finishes in time', async () => {
  const warehouse = await fakeWarehouse({ created: done });
  try {
    const rows = await warehouse.service.queryRows({ statement: 'SELECT count(*) AS rows_loaded FROM gold.veltrix_sales_daily', warehouseId: 'wh-1' });
    assert.deepEqual(rows, [{ rows_loaded: 500 }]);
    assert.equal(warehouse.calls.submitted[0].wait_timeout, '30s');
    assert.equal(warehouse.calls.submitted[0].on_wait_timeout, 'CANCEL', 'without CANCEL Databricks keeps running the statement after the app gives up');
  } finally { warehouse.close(); }
});

test('a statement Databricks cancelled at the timeout is reported as a timeout, not a failure', async () => {
  const warehouse = await fakeWarehouse({ created: { statement_id: 's-2', status: { state: 'CANCELED' } } });
  try {
    await assert.rejects(warehouse.service.queryRows({ statement: 'SELECT * FROM gold.big_table', warehouseId: 'wh-1' }), error => error.code === 'STATEMENT_TIMEOUT' && /took longer than 30 seconds and was stopped/.test(error.message));
    assert.equal(warehouse.calls.cancelled.length, 0, 'Databricks already stopped it; no second cancel is needed');
  } finally { warehouse.close(); }
});

test('a statement still running after the wait is cancelled explicitly before the error is raised', async () => {
  const running = { statement_id: 's-3', status: { state: 'RUNNING' } };
  const warehouse = await fakeWarehouse({ created: running, polls: [running] });
  try {
    await assert.rejects(warehouse.service.queryRows({ statement: 'SELECT * FROM gold.big_table', warehouseId: 'wh-1' }), { code: 'STATEMENT_TIMEOUT' });
    assert.deepEqual(warehouse.calls.cancelled, ['/api/2.0/sql/statements/s-3/cancel']);
  } finally { warehouse.close(); }
});

test('the wait is kept inside the 5 to 50 seconds Databricks accepts, and a failed statement keeps its own message', async () => {
  const warehouse = await fakeWarehouse({ created: { statement_id: 's-4', status: { state: 'FAILED', error: { message: '[TABLE_OR_VIEW_NOT_FOUND] gold.missing' } } } });
  try {
    await assert.rejects(warehouse.service.queryRows({ statement: 'SELECT * FROM gold.missing', warehouseId: 'wh-1', timeoutSeconds: 120 }), /SQL statement failed: \[TABLE_OR_VIEW_NOT_FOUND\]/);
    await assert.rejects(warehouse.service.queryRows({ statement: 'SELECT 1', warehouseId: 'wh-1', timeoutSeconds: 1 }));
    assert.deepEqual(warehouse.calls.submitted.map(body => body.wait_timeout), ['50s', '5s']);
  } finally { warehouse.close(); }
});
