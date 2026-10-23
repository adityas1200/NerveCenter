import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { postgresConnectionFields, postgresSslOptions } from '../src/storage/postgres.mjs';

test('SPEC-platform-06 FR-2a: customer Postgres verifies the server certificate and refuses TLS disable', () => {
  assert.deepEqual(postgresSslOptions('databricks'), { rejectUnauthorized: true });
  assert.throws(() => postgresSslOptions('databricks', 'disable'), /TLS cannot be disabled/);
  assert.deepEqual(postgresSslOptions('aws'), { rejectUnauthorized: false });
  assert.equal(postgresSslOptions('aws', 'disable'), false);
});

test('SPEC-platform-06 FR-2a: URL sslmode cannot replace customer Postgres TLS settings', () => {
  const fields = postgresConnectionFields('postgresql://test-user:test-password@db.example.invalid:5433/ops?sslmode=disable&sslrootcert=/tmp/untrusted.pem');
  assert.deepEqual(fields, { host: 'db.example.invalid', port: 5433, database: 'ops', user: 'test-user', password: 'test-password' });
  const client = new pg.Client({ ...fields, ssl: postgresSslOptions('databricks') });
  assert.deepEqual(client.connectionParameters.ssl, { rejectUnauthorized: true });
});
