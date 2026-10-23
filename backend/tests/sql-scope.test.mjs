import test from 'node:test';
import assert from 'node:assert/strict';
import { fullName, inSchema, mentions, shapeOf, swapTable } from '../src/tasks/sql-scope.mjs';

// SPEC-tasks-13 FR-3, FR-5, FR-7: the sandbox tools write without asking only inside the sandbox schema,
// so the statement check is deny by default and reads names from tokens, never from strings or comments.

test('FR-3: each allowed write shape names its target', () => {
  const cases = [
    ['INSERT INTO c.s.t SELECT * FROM c.gold.x', 'insert into', 'c.s.t'],
    ['insert overwrite table c.s.t select 1', 'insert overwrite', 'c.s.t'],
    ["UPDATE c.s.t SET payer_type = 'Commercial' WHERE payer_type = 'COMM'", 'update', 'c.s.t'],
    ['DELETE FROM `c`.`s`.`t` WHERE x = 1', 'delete from', 'c.s.t'],
    ['MERGE INTO c.s.t USING c.gold.src ON t.id = src.id WHEN MATCHED THEN UPDATE SET *', 'merge into', 'c.s.t'],
    ['CREATE OR REPLACE TABLE c.s.t AS SELECT * FROM c.gold.x', 'create or replace table', 'c.s.t'],
    ['CREATE TABLE IF NOT EXISTS c.s.t SHALLOW CLONE c.gold.x', 'create table', 'c.s.t'],
    ['ALTER TABLE c.s.t ADD COLUMN y INT', 'alter table', 'c.s.t'],
    ['DROP TABLE IF EXISTS c.s.t', 'drop table', 'c.s.t'],
    ['TRUNCATE TABLE c.s.t', 'truncate table', 'c.s.t'],
    ['  -- fix the copy\n  UPDATE c.s.t SET a = 1;  ', 'update', 'c.s.t'],
  ];
  for (const [sql, verb, target] of cases) assert.deepEqual(shapeOf(sql), { kind: 'write', verb, target, others: [] }, sql);
  assert.deepEqual(shapeOf('SELECT COUNT(*) FROM c.gold.x'), { kind: 'select' });
  assert.deepEqual(shapeOf('WITH a AS (SELECT 1) SELECT * FROM a'), { kind: 'select' });
});

test('FR-3: everything outside the allowed shapes is refused with a reason', () => {
  const refused = [
    ['UPDATE c.s.t SET a = 1; DROP TABLE c.gold.x', /one statement at a time/],
    ['GRANT SELECT ON TABLE c.s.t TO `someone`', /Access changes/],
    ['SELECT 1 FROM c.s.t WHERE x IN (SELECT 1); REVOKE ALL ON c.s.t FROM y', /one statement|Access/],
    ['WITH src AS (SELECT 1) INSERT INTO c.s.t SELECT * FROM src', /WITH may only read/],
    ['INSERT ALL INTO c.s.a INTO c.s.b SELECT 1', /INSERT INTO or INSERT OVERWRITE/],
    ['UPDATE s.t SET a = 1', /Name the table in full/],
    ['COPY INTO c.s.t FROM @stage', /COPY statements are not allowed/],
    ['CALL c.s.proc()', /CALL statements are not allowed/],
    ['OPTIMIZE c.s.t', /OPTIMIZE statements are not allowed/],
    ['CREATE SCHEMA c.other', /Only CREATE TABLE and CREATE VIEW/],
    ["UPDATE c.s.t SET a = 'unclosed", /never closed/],
    ['', /empty/],
  ];
  for (const [sql, reason] of refused) assert.throws(() => shapeOf(sql), reason, sql);
});

test('FR-3: a rename is checked on both names', () => {
  assert.deepEqual(shapeOf('ALTER TABLE c.s.t RENAME TO c.gold.t'), { kind: 'write', verb: 'alter table', target: 'c.s.t', others: ['c.gold.t'] });
  assert.throws(() => shapeOf('ALTER TABLE c.s.t RENAME TO t2'), /Name the new table in full/);
});

test('FR-3: names inside strings and comments are not names', () => {
  // A string that looks like the target never counts as a write target.
  const shape = shapeOf("UPDATE c.sandbox.t SET note = 'UPDATE c.gold.x' /* c.gold.x */ WHERE id = 1");
  assert.equal(shape.target, 'c.sandbox.t');
  assert.equal(mentions("SELECT 'c.gold.x' AS text FROM c.sandbox.t -- c.gold.x", 'c.gold.x'), false);
  // Snowflake reads "…" as a name, Databricks as a string.
  assert.equal(mentions('SELECT * FROM "DB"."GOLD"."X"', 'db.gold.x', 'snowflake'), true);
  assert.equal(mentions('SELECT "db.gold.x" FROM y', 'db.gold.x', 'databricks'), false);
});

test('FR-7: swapping replaces full and schema.table references only', () => {
  const sql = "SELECT payer_type, SUM(trx_count) AS trx FROM commercial.gold.veltrix_sales_daily v JOIN gold.veltrix_sales_daily w ON 1=1 WHERE note <> 'commercial.gold.veltrix_sales_daily' AND x.veltrix_sales_daily = 1 GROUP BY payer_type";
  const swapped = swapTable(sql, 'commercial.gold.veltrix_sales_daily', 'commercial_dev.sonic.veltrix_fix_ab12cd');
  assert.equal(swapped.count, 2);
  assert.equal(swapped.sql, "SELECT payer_type, SUM(trx_count) AS trx FROM commercial_dev.sonic.veltrix_fix_ab12cd v JOIN commercial_dev.sonic.veltrix_fix_ab12cd w ON 1=1 WHERE note <> 'commercial.gold.veltrix_sales_daily' AND x.veltrix_sales_daily = 1 GROUP BY payer_type");
  assert.equal(swapTable('SELECT * FROM `commercial`.`gold`.`veltrix_sales_daily`', 'commercial.gold.veltrix_sales_daily', 'a.b.c').sql, 'SELECT * FROM a.b.c');
  assert.equal(mentions('SELECT * FROM gold.veltrix_sales_daily', 'commercial.gold.veltrix_sales_daily'), true);
  assert.equal(mentions('SELECT * FROM other.gold.veltrix_sales_daily', 'commercial.gold.veltrix_sales_daily'), false);
});

test('full names and the sandbox schema', () => {
  assert.equal(fullName(' Commercial.Gold.T '), 'commercial.gold.t');
  assert.equal(fullName('`c`.`s`.`t`'), 'c.s.t');
  assert.throws(() => fullName('gold.t'), /catalog\.schema\.table/);
  assert.throws(() => fullName('c.s.t; drop'), /is not one/);
  assert.equal(fullName('c.sandbox', 'schema', 2), 'c.sandbox');
  assert.equal(inSchema('c.sandbox.t', 'c.sandbox'), true);
  assert.equal(inSchema('c.sandboxes.t', 'c.sandbox'), false);
  assert.equal(inSchema('sandbox.t', 'c.sandbox'), false);
});
