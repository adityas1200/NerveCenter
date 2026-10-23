import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { normalizeBasePath } from './lib/base-path.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
const REPO_ROOT = path.resolve(ROOT, '..');

// Local development may load backend/.env. Tests set OPS_TEST_DATA_ROOT before
// importing this module and must never inherit repository credentials or paths.
const envFile = path.join(ROOT, '.env');
const isolatedTestProcess = Boolean(process.env.OPS_TEST_DATA_ROOT);
if (!isolatedTestProcess && fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
  }
}

export const DATA_DIR = path.join(ROOT, 'data');
// SQL migrations (Postgres) and their .mjs twins (file store) live together.
export const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
export const RUNTIME_DIR = process.env.OPS_RUNTIME_DIR ? path.resolve(process.env.OPS_RUNTIME_DIR) : path.join(DATA_DIR, 'runtime');
// The agent workspace: operations.yaml, knowledge/, workflows/, .mcp.json, tasks/. One per deployment.
export const WORKSPACE_DIR = process.env.OPS_WORKSPACE_DIR ? path.resolve(process.env.OPS_WORKSPACE_DIR) : path.join(ROOT, 'workspace');
// The vendored operations-fleet plugin every agent session loads.
export const PLUGIN_DIR = process.env.OPS_PLUGIN_DIR ? path.resolve(process.env.OPS_PLUGIN_DIR) : path.join(REPO_ROOT, 'plugin', 'operations-fleet');

// Where this instance runs. `databricks` (a Databricks App) changes the defaults below: Lakebase for
// Postgres, a Unity Catalog volume for the workspace mirror, secrets in Lakebase, and the identity the
// Apps proxy forwards. Detected from the variables the Apps runtime injects; OPS_PLATFORM overrides it.
const platform = (process.env.OPS_PLATFORM || (process.env.DATABRICKS_APP_PORT || process.env.DATABRICKS_APP_NAME ? 'databricks' : 'aws')).trim().toLowerCase();
if (!['aws', 'databricks'].includes(platform)) throw new Error('OPS_PLATFORM must be aws or databricks');
const onDatabricks = platform === 'databricks';
// The Apps runtime may inject DATABRICKS_HOST as a bare hostname; every consumer (the deployment Databricks
// connection, agent MCP servers) expects a URL, so normalize it once here.
if (onDatabricks && process.env.DATABRICKS_HOST) process.env.DATABRICKS_HOST = normalizeHost(process.env.DATABRICKS_HOST);

const identityMode = process.env.OPS_IDENTITY_MODE || (onDatabricks ? 'databricks-apps' : process.env.NODE_ENV === 'production' ? 'trusted-gateway' : 'development');
// Per-environment SSO fallback so shared k8s Secrets don't need to carry OPS_SSO_SESSION_URL.
// An explicit OPS_SSO_SESSION_URL still wins.
const SSO_URL_BY_ENV = {
  'zs-dev': 'https://agenticdm.dev.zsservices.com/apps/api/v1/auth/session',
  'dev': 'https://agenticdm.dev.zsservices.com/apps/api/v1/auth/session',
  'development': 'https://agenticdm.dev.zsservices.com/apps/api/v1/auth/session',
  'zs-sandbox': 'https://edma.zssandbox.com/dataverse/apps/api/v1/auth/session',
  'sandbox': 'https://edma.zssandbox.com/dataverse/apps/api/v1/auth/session',
};
const deployEnvName = (process.env.BEACON_ENV || process.env.APP_ENV || process.env.NC_ENVIRONMENT || '').trim().toLowerCase();
const sandboxSsoSessionUrl = 'https://edma.zssandbox.com/dataverse/apps/api/v1/auth/session';
const ssoSessionUrl = process.env.OPS_SSO_SESSION_URL || SSO_URL_BY_ENV[deployEnvName] || sandboxSsoSessionUrl;
if (!process.env.OPS_SSO_SESSION_URL && identityMode === 'central-sso') console.warn(`[config] OPS_SSO_SESSION_URL not set; using the default for '${deployEnvName || 'unknown'}' (${ssoSessionUrl})`);
// A Databricks App is one process behind the Apps proxy, so a per-boot random token is enough there.
const internalServiceToken = process.env.OPS_INTERNAL_SERVICE_TOKEN || process.env.OPS_TRUSTED_IDENTITY_TOKEN || (process.env.NODE_ENV === 'production' && !onDatabricks ? '' : randomBytes(32).toString('hex'));

if (!['development', 'single-user', 'trusted-gateway', 'central-sso', 'databricks-apps'].includes(identityMode)) throw new Error('OPS_IDENTITY_MODE must be development, single-user, trusted-gateway, central-sso, or databricks-apps');

// Accepts a full DATABASE_URL, dataverse-style discrete keys (db_host/db_port/db_name/
// db_user/db_password) shared across sibling apps, or the libpq PG* variables a Databricks App's
// Lakebase resource injects. Normalizes SQLAlchemy driver suffixes (postgresql+psycopg://) to the
// plain scheme the node-postgres client expects.
const rawDatabaseUrl = process.env.DATABASE_URL || process.env.NC_DATABASE_URL || buildDatabaseUrlFromParts();
const databaseUrl = rawDatabaseUrl.replace(/^postgres(ql)?\+[a-z0-9_]+:\/\//i, 'postgresql://');
const dbSchema = (process.env.NC_DB_SCHEMA || process.env.NERVECENTER_DB_SCHEMA || '').trim();
// `databricks-oauth`: Lakebase has no static password; each new connection signs in with a
// short-lived OAuth token minted for the app's service principal. `password`: whatever the URL carries.
const dbAuth = (process.env.OPS_DB_AUTH || (onDatabricks && !process.env.PGPASSWORD && !process.env.db_password ? 'databricks-oauth' : 'password')).trim().toLowerCase();
if (!['password', 'databricks-oauth'].includes(dbAuth)) throw new Error('OPS_DB_AUTH must be password or databricks-oauth');

function buildDatabaseUrlFromParts() {
  const host = process.env.db_host || process.env.PGHOST || '';
  if (!host) return '';
  const port = process.env.db_port || process.env.PGPORT || '5432';
  const name = process.env.db_name || process.env.PGDATABASE || 'postgres';
  const user = encodeURIComponent(process.env.db_user || process.env.PGUSER || '');
  const password = encodeURIComponent(process.env.db_password || process.env.PGPASSWORD || '');
  const auth = user ? `${user}${password ? `:${password}` : ''}@` : '';
  return `postgresql://${auth}${host}:${port}/${name}`;
}

// Admins bypass per-ticket ownership checks: grant either via role (from the identity
// provider/gateway), an env allow-list, or the editable data/config/admins.json file.
const adminRole = process.env.OPS_ADMIN_ROLE || 'ops-admin';
const ADMIN_LIST_FILE = process.env.OPS_ADMIN_LIST_FILE ? path.resolve(process.env.OPS_ADMIN_LIST_FILE) : path.join(DATA_DIR, 'config', 'admins.json');
function readAdminListFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ADMIN_LIST_FILE, 'utf8'));
    return Array.isArray(parsed?.adminUserIds) ? parsed.adminUserIds : [];
  } catch {
    return [];
  }
}
// No admins are baked into the build: each deployment names its own, so nobody is an admin on
// every stack by default. A fresh deploy needs at least one in OPS_ADMIN_USER_IDS (dev sets it in
// .env.defaults) or OPS_RBAC_SEED_ADMINS; they then promote others in Settings. SSO ids are the
// lowercase email (identity.mjs), so list people by email.
function parseSeedAdminsEnv() {
  const raw = (process.env.OPS_RBAC_SEED_ADMINS || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(entry => ({ id: String(entry?.id || '').trim(), name: String(entry?.name || '').trim(), email: String(entry?.email || '').trim() })).filter(entry => entry.id);
  } catch {
    return [];
  }
}
const seedAdmins = (() => {
  const merged = new Map();
  for (const entry of parseSeedAdminsEnv()) {
    if (!entry.id) continue;
    const existing = merged.get(entry.id) || {};
    merged.set(entry.id, { id: entry.id, name: entry.name || existing.name || entry.id, email: entry.email || existing.email || '' });
  }
  return [...merged.values()];
})();
const envAdminUserIds = (process.env.OPS_ADMIN_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
// Shown to anonymous callers on the sign-in page as the people to ask for access, so env entries only: the
// admins.json file and non-email ids (service accounts) stay private (SPEC-platform-09 FR-9).
const adminContacts = [...new Set(envAdminUserIds.filter(value => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value)))];
const adminUserIds = [...new Set([...envAdminUserIds, ...readAdminListFile().map(value => String(value).trim()).filter(Boolean)])];

export const config = {
  platform,
  environment: process.env.NODE_ENV === 'production' ? 'production' : isolatedTestProcess ? 'test' : 'development',
  adminRole,
  adminUserIds,
  adminContacts,
  seedAdmins,
  // A Databricks App must listen on DATABRICKS_APP_PORT on every interface.
  host: process.env.HOST || (onDatabricks ? '0.0.0.0' : '127.0.0.1'),
  port: Number(process.env.PORT || process.env.DATABRICKS_APP_PORT || 8787),
  publicUrl: process.env.OPS_PUBLIC_URL || process.env.DATABRICKS_APP_URL || `http://${process.env.HOST || '127.0.0.1'}:${Number(process.env.PORT || 8787)}`,
  corsOrigin: process.env.OPS_CORS_ORIGIN || (onDatabricks && process.env.DATABRICKS_APP_URL ? new URL(process.env.DATABRICKS_APP_URL).origin : '*'),
  // The built frontend (index.html + assets). Set when the backend serves the UI itself, as a
  // Databricks App does; the EC2 stack serves it from nginx instead.
  // Path prefix the ingress puts in front of this process (e.g. /apps/nervecenter). Stripped from every
  // request, so the API and the UI answer both with and without it.
  publicBasePath: normalizeBasePath(process.env.OPS_PUBLIC_BASE_PATH),
  frontendDir: process.env.OPS_FRONTEND_DIR ? path.resolve(process.env.OPS_FRONTEND_DIR) : '',
  anthropicApiKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
  ticketPrefix: process.env.OPS_TICKET_PREFIX || 'OPS',
  // Issue type -> approver shown on the ticket. Override with OPS_APPROVER_ROUTING as JSON
  // ({"data_quality":{"id":"...","name":"..."},...}); keys are matched against the ticket type, then category.
  approverRouting: (() => {
    const fallback = {
      data_quality: { id: 'dq.lead', name: 'Data Quality Lead' },
      data: { id: 'dq.lead', name: 'Data Quality Lead' },
      pipeline_failure: { id: 'platform.oncall', name: 'Platform On-call' },
      incident: { id: 'platform.oncall', name: 'Platform On-call' },
      access_request: { id: 'access.approver', name: 'Access Approver' },
      access: { id: 'access.approver', name: 'Access Approver' },
      default: { id: 'ops.lead', name: 'Operations Lead' },
    };
    try {
      const parsed = process.env.OPS_APPROVER_ROUTING ? JSON.parse(process.env.OPS_APPROVER_ROUTING) : null;
      return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
    } catch {
      return fallback;
    }
  })(),
  defaultUserId: process.env.OPS_DEFAULT_USER_ID || 'demo.user',
  defaultUserName: process.env.OPS_DEFAULT_USER_NAME || process.env.OPS_DEFAULT_USER_ID || 'Demo User',
  identityMode,
  trustedIdentityToken: process.env.OPS_TRUSTED_IDENTITY_TOKEN || '',
  ssoSessionUrl,
  internalServiceToken,
  maxRequestBytes: Number(process.env.OPS_MAX_REQUEST_BYTES || 8 * 1024 * 1024),
  maxUploadBytes: Number(process.env.OPS_MAX_UPLOAD_BYTES || 20 * 1024 * 1024),

  // ServiceNow deployment-level credentials (a managed connection profile wins when present).
  serviceNowInstance: process.env.SERVICENOW_INSTANCE || process.env.OPS_SERVICENOW_INSTANCE || '',
  serviceNowUsername: process.env.SERVICENOW_USERNAME || '',
  serviceNowSecretRef: process.env.OPS_SERVICENOW_SECRET_REF || 'integrations/servicenow/credential',
  serviceNowQuery: process.env.OPS_SERVICENOW_QUERY || 'active=true^ORDERBYDESCsys_updated_on',

  // Local and single-container deployments use files; shared deployments use PostgreSQL and S3
  // (AWS) or Lakebase and a Unity Catalog volume (Databricks).
  metadataStore: process.env.OPS_METADATA_STORE || (databaseUrl ? 'postgres' : 'file'),
  secretStore: process.env.OPS_SECRET_STORE || (onDatabricks ? 'postgres' : 'memory'),
  // Encrypts the postgres secret store. On Databricks it comes from a secret-scope app resource.
  secretEncryptionKey: process.env.OPS_SECRET_ENCRYPTION_KEY || '',
  databaseUrl,
  dbSchema,
  dbAuth,
  // Lakebase Provisioned instance name: tokens are then minted for that instance. Without it the
  // service principal's workspace OAuth token is the password.
  lakebaseInstance: process.env.LAKEBASE_INSTANCE_NAME || process.env.OPS_LAKEBASE_INSTANCE || '',
  databricksHost: normalizeHost(process.env.DATABRICKS_HOST || ''),
  // `s3` or `volume`: where the agent workspace is mirrored. Defaults follow the platform.
  objectStore: (process.env.OPS_OBJECT_STORE || (onDatabricks ? 'volume' : 's3')).trim().toLowerCase(),
  // /Volumes/<catalog>/<schema>/<volume>, or catalog.schema.volume as a volume app resource resolves.
  volumePath: volumePath(process.env.OPS_VOLUME_PATH),
  s3Bucket: process.env.s3_bucket || process.env.OPS_S3_BUCKET || '',
  s3Prefix: (process.env.NC_S3_PREFIX || process.env.NERVECENTER_S3_PREFIX || process.env.OPS_S3_PREFIX || 'nervecenter').replace(/^\/+|\/+$/g, ''),
  // Match sibling apps (ai_for_data, ai4dm) which default to us-east-1; k8s ConfigMap does not set AWS_REGION.
  awsRegion: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
};

function normalizeHost(value) {
  const host = String(value || '').trim().replace(/\/+$/, '');
  if (!host) return '';
  return /^https?:\/\//i.test(host) ? host : `https://${host}`;
}

function volumePath(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (/^[^./]+\.[^./]+\.[^./]+$/.test(raw)) return `/Volumes/${raw.split('.').join('/')}`;
  return raw;
}
