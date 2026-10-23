import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir, pilot } from './helpers.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { ticketPageSql } from '../src/app/ticket-page.mjs';
import { createBackend } from '../src/bootstrap.mjs';
import { createApiServer } from '../src/api/server.mjs';

const access = { all:false,userId:'alice',ownerProjects:[],approverIds:['alice'],routing:{} };
const query = {limit:10,offset:0,scope:'active',sort:'priority',dir:'asc',access};
const ticket = (n, extra = {}) => ({ticketId:`OPS-${String(n).padStart(5,'0')}`,projectId:'pilot',title:`Ticket ${n}`,status:'open',priority:'medium',visibility:'project',createdAt:new Date(1_700_000_000_000+n*1000).toISOString(),updatedAt:new Date(1_700_000_000_000+n*1000).toISOString(),...extra});

test('SPEC-platform-11 FR-3 and SPEC-tickets-05 FR-1: file ticket pages reach rows beyond 5000 and count before paging', async () => {
  const dir = await tempDir('nc-ticket-page-');
  const file = path.join(dir,'tickets.json');
  const tickets = Object.fromEntries(Array.from({length:5002},(_,n) => { const row = ticket(n); return [row.ticketId,row]; }));
  await fs.writeFile(file,JSON.stringify({ticketCounter:6000,tickets,boards:{},dataQuality:{}}));
  const store = new FileOperationsStore(file); await store.init();
  const page = await store.listTicketPage(pilot,{...query,offset:5000});
  assert.equal(page.total,5002); assert.deepEqual(page.items.map(row => row.ticketId),['OPS-05000','OPS-05001']);
  assert.equal(page.meta.open,5002); assert.equal(page.meta.scoped,5002);
});

test('SPEC-tickets-05 FR-2 to FR-5: file page filters privacy before totals and sorts globally', async () => {
  const dir = await tempDir('nc-ticket-filter-'); const store = new FileOperationsStore(path.join(dir,'tickets.json')); await store.init();
  for (const row of [ticket(1,{priority:'low'}),ticket(2,{priority:'critical'}),ticket(3,{priority:'critical',visibility:'private',creator:{id:'other'}}),ticket(4,{priority:'high',visibility:'private',creator:{id:'alice'}}),ticket(5,{status:'closed',closedAt:'2024-01-01T00:00:00.000Z',taskId:'T-5',taskChanges:1})]) await store.createTicket(row);
  const page = await store.listTicketPage(pilot,{...query,priority:['critical','high'],limit:1});
  assert.equal(page.total,2); assert.equal(page.meta.open,3); assert.equal(page.meta.highOpen,2); assert.equal(page.meta.closed,1);
  assert.equal(page.items[0].ticketId,'OPS-00002');
  const second = await store.listTicketPage(pilot,{...query,priority:['critical','high'],limit:1,offset:1});
  assert.equal(second.items[0].ticketId,'OPS-00004');
  const closed = await store.listTicketPage(pilot,{...query,scope:'closed',resolved:true,from:'2023-12-31T00:00:00.000Z'});
  assert.deepEqual(closed.items.map(row=>row.ticketId),['OPS-00005']);
  assert.equal(closed.meta.resolved,1);
});

test('SPEC-platform-11 FR-3: Postgres page SQL filters before LIMIT/OFFSET and binds request values', () => {
  const sql = ticketPageSql(query);
  assert.match(sql.page,/FROM filtered ORDER BY .* LIMIT \$3 OFFSET \$4/);
  assert.match(sql.page,/FROM ops_tickets/);
  assert.match(sql.page,/jsonb_array_elements_text/);
  assert.doesNotMatch(sql.page,/5000/);
});

test('SPEC-platform-11 FR-3: HTTP ticket page validates bounds and returns exact totals', async () => {
  const backend = await createBackend();
  await backend.projectStore.addMember('pilot','alice',{id:'test'});
  for (const row of [ticket(901),ticket(902),ticket(903)]) await backend.operationsService.store.createTicket(row);
  const server = createApiServer(backend); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = {'x-nervecenter-project':'pilot','x-user-id':'alice','x-user-name':'alice'};
    const response = await fetch(`${base}/api/tickets?scope=all&limit=2&offset=2&sort=title`,{headers});
    assert.equal(response.status,200);
    const body = await response.json();
    assert.equal(body.total,3); assert.equal(body.items.length,1); assert.equal(body.meta.open,3);
    const invalid = await fetch(`${base}/api/tickets?limit=101`,{headers});
    assert.equal(invalid.status,400);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
