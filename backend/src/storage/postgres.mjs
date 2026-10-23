import { config } from '../config.mjs';
import { applyControlMigrations } from './migrations.mjs';

let sharedPool;
export async function getPgPool() {
  if (sharedPool) return sharedPool;
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required for postgres metadata storage');
  const { Pool } = await import('pg');
  const ssl = postgresSslOptions();
  // The shared dataverse Postgres hosts multiple apps; pin every connection to NerveCenter's schema.
  const schema = (config.dbSchema || '').replace(/[^a-zA-Z0-9_]/g, '');
  const options = schema ? `-c search_path=${schema},public` : undefined;
  sharedPool = new Pool({ ...await connectionOptions(), max: Number(process.env.OPS_PG_POOL_MAX || 20), ssl, options });
  if (schema) await sharedPool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  return sharedPool;
}

export function postgresSslOptions(platform = config.platform, setting = process.env.OPS_PG_SSL) {
  if (platform === 'databricks') {
    if (setting === 'disable') throw new Error('Postgres TLS cannot be disabled in a Databricks customer deployment');
    return { rejectUnauthorized: true };
  }
  // The shared RDS CA is not configured in this process's trust store yet.
  return setting === 'disable' ? false : { rejectUnauthorized: false };
}

export function postgresConnectionFields(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be a Postgres URL');
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

// Lakebase (OPS_DB_AUTH=databricks-oauth) has no fixed password: node-postgres calls `password` for
// every new connection, so each one signs in with a current OAuth token. The discrete fields are
// passed instead of the URL because a connection string's (empty) password would win over the callback.
async function connectionOptions() {
  if (config.platform !== 'databricks' && config.dbAuth !== 'databricks-oauth') return { connectionString: config.databaseUrl };
  // A connection string's sslmode/sslrootcert can replace the Pool ssl object. Pass
  // discrete fields in customer deployments so URL query options cannot weaken TLS.
  const fields = postgresConnectionFields(config.databaseUrl);
  if (config.dbAuth !== 'databricks-oauth') return fields;
  const { LakebaseTokenProvider } = await import('../platform/databricks-app.mjs');
  const tokens = new LakebaseTokenProvider();
  return { ...fields, password: () => tokens.password() };
}

// Ticket idempotency (a unique source key and a unique run, both per connection) is created by
// migrations/004-ticket-connection.sql, not here: this runs on every boot and must not bring back the old global constraints.
export async function ensureControlSchema(pool) {
  pool ||= await getPgPool();
  await applyControlMigrations(pool);
  return pool;
}
