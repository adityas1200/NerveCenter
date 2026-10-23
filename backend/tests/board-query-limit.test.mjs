import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BoardService } from '../src/boards/board-service.mjs';
import { systemScope } from '../src/projects/project-access.mjs';
import { DatabricksOperationsService } from '../src/connectors/databricks/databricks-service.mjs';

test('board SQL bounds the provider result before fetching it', async () => {
  const calls = [];
  const boards = new BoardService({
    connectionService: { resolve: async provider => ({ profile: { id: provider }, config: { warehouseId: 'wh-1' }, credentials: {} }) },
    databricksFactory: () => ({ queryRows: async args => { calls.push({ provider: 'databricks', ...args }); return Array.from({ length: 300 }, (_, index) => ({ index })); } }),
    snowflakeFactory: () => ({ queryRows: async args => { calls.push({ provider: 'snowflake', ...args }); return Array.from({ length: 300 }, (_, index) => ({ index })); } }),
  });
  const widget = provider => ({ type: 'table', title: 'Rows', source: { kind: 'sql', provider, statement: 'SELECT index FROM approved_view ORDER BY index DESC' } });
  for (const provider of ['databricks', 'snowflake']) {
    const result = await boards.preview(widget(provider), {}, { id: 'builder', role: 'developer' }, null, systemScope('pilot'));
    assert.equal(result.rows.length, 200);
  }
  assert.equal(calls[0].rowLimit, 200);
  assert.equal(calls[1].statement, 'SELECT * FROM (\nSELECT index FROM approved_view ORDER BY index DESC\n) AS board_rows LIMIT 200');
});

test('Databricks sends the board row limit to Statement Execution', async () => {
  let submitted;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      submitted = JSON.parse(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'count' }] } }, result: { data_array: [[1]] } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const service = new DatabricksOperationsService({ host: `http://127.0.0.1:${server.address().port}`, token: 'fake-token' });
    await service.queryRows({ statement: 'SELECT count FROM approved_view', warehouseId: 'wh-1', rowLimit: 200 });
    assert.equal(submitted.row_limit, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
