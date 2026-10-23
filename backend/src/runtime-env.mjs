// Node port of ai_for_data/backend/runtime_env.py so NerveCenter self-hydrates
// its environment from AWS Secrets Manager at boot the same way sibling apps do.
// Must run before config.mjs is imported.

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLACEHOLDER_VALUES = new Set(['<FILL_ME>', 'FILL_ME', 'changeme', 'change-me', 'replace-me', 'todo']);

// Each row lists synonyms that all resolve to the same underlying value.
// The first entry is the "canonical" name used in the secret payload; the rest
// are env-var aliases the app (or its dependencies) may look up.
// Only ACTUAL SECRETS/CREDENTIALS live here. Per-environment configuration
// (schema names, path prefixes, routing URLs) belongs in .env on the host,
// not the secret payload — otherwise docker-compose defaults silently block
// hydration when the compose default is non-blank.
const ALIAS_GROUPS = [
  ['db_host', 'DB_HOST', 'POSTGRES_HOST', 'RDS_HOST'],
  ['db_port', 'DB_PORT', 'POSTGRES_PORT', 'RDS_PORT'],
  ['db_name', 'DB_NAME', 'POSTGRES_DB', 'RDS_DB'],
  ['db_user', 'DB_USER', 'POSTGRES_USER', 'RDS_USER'],
  ['db_password', 'DB_PASSWORD', 'POSTGRES_PASSWORD', 'RDS_PASSWORD'],
  ['database_url', 'DATABASE_URL', 'NC_DATABASE_URL'],
  ['s3_bucket', 'S3_BUCKET', 'OPS_S3_BUCKET', 'STORAGE_S3_BUCKET'],
  ['s3_bucket_arn', 'S3_BUCKET_ARN'],
  ['aws_region', 'AWS_REGION', 'AWS_DEFAULT_REGION'],
  ['anthropic_api_key', 'ANTHROPIC_API_KEY', 'NC_ANTHROPIC_API_KEY'],
  ['jwt_secret', 'NC_JWT_SECRET', 'JWT_SECRET'],
  ['app_secret_key', 'NC_SECRET_KEY', 'SECRET_KEY'],
  ['trusted_identity_token', 'OPS_TRUSTED_IDENTITY_TOKEN'],
  ['sso_session_url', 'OPS_SSO_SESSION_URL'],
  ['servicenow_instance', 'SERVICENOW_INSTANCE'],
  ['servicenow_username', 'SERVICENOW_USERNAME'],
  ['servicenow_password', 'SERVICENOW_PASSWORD'],
  ['databricks_host', 'DATABRICKS_HOST'],
  ['databricks_token', 'DATABRICKS_TOKEN'],
  ['databricks_client_id', 'DATABRICKS_CLIENT_ID'],
  ['databricks_client_secret', 'DATABRICKS_CLIENT_SECRET'],
  ['snowflake_account', 'SNOWFLAKE_ACCOUNT'],
  ['snowflake_user', 'SNOWFLAKE_USER'],
  ['snowflake_password', 'SNOWFLAKE_PASSWORD'],
  ['snowflake_private_key', 'SNOWFLAKE_PRIVATE_KEY'],
  ['snowflake_warehouse', 'SNOWFLAKE_WAREHOUSE'],
  ['snowflake_database', 'SNOWFLAKE_DATABASE'],
  ['snowflake_schema', 'SNOWFLAKE_SCHEMA'],
  ['snowflake_role', 'SNOWFLAKE_ROLE'],
];

function log(message) {
  console.error(`[RUNTIME_ENV] ${message}`);
}

function splitCsv(value) {
  if (!value) return [];
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function deployEnv() {
  return (
    process.env.BEACON_ENV
    || process.env.APP_ENV
    || process.env.NC_ENVIRONMENT
    || process.env.DEPLOY_ENV
    || process.env.ENV
    || 'development'
  ).trim();
}

function shouldLoad() {
  const mode = (process.env.USE_AWS_SECRETS || 'auto').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(mode)) return true;
  if (['false', '0', 'no', 'off'].includes(mode)) return false;
  // A Databricks App gets its secrets from app resources (app.yaml valueFrom), not AWS.
  if ((process.env.OPS_PLATFORM || '').trim().toLowerCase() === 'databricks' || process.env.DATABRICKS_APP_PORT) return false;
  // 'development' included so an unset APP_ENV/BEACON_ENV on dev still hydrates
  // secrets (falls back to beacon/development/* which the deploy owns).
  return ['sandbox', 'zs-sandbox', 'staging', 'dev', 'zs-dev', 'development', 'development-aws', 'prod', 'zs-prod', 'production'].includes(deployEnv().toLowerCase());
}

function secretBase() {
  const prefix = (process.env.AWS_SECRET_PREFIX || 'beacon').replace(/^\/+|\/+$/g, '');
  const env = deployEnv().replace(/^\/+|\/+$/g, '');
  if (!env) return prefix;
  if (prefix.endsWith(`/${env}`)) return prefix;
  return `${prefix}/${env}`;
}

function secretIds() {
  const explicit = splitCsv(process.env.AWS_SECRET_IDS || process.env.AWS_SECRETS_IDS);
  if (explicit.length) return explicit;
  const groups = splitCsv(process.env.AWS_SECRET_GROUPS);
  // App-specific group listed first so first-write-wins in loadSecret gives it
  // precedence over the shared "common" group for any overlapping key.
  const resolved = groups.length ? groups : ['nervecenter', 'common'];
  const base = secretBase();
  return resolved.map(group => (group.startsWith('arn:') || group.includes('/') ? group : `${base}/${group}`));
}

function aliasesFor(key) {
  const lowered = String(key).toLowerCase();
  for (const group of ALIAS_GROUPS) {
    if (group.some(item => item.toLowerCase() === lowered)) return group;
  }
  return [key];
}

function isPlaceholder(value) {
  return PLACEHOLDER_VALUES.has(String(value).trim());
}

function hasExistingEnvValue(name) {
  const value = process.env[name];
  if (value === undefined || value === null) return false;
  const trimmed = String(value).trim();
  if (trimmed === '' || isPlaceholder(trimmed)) return false;
  return true;
}

function coerceSecretValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function candidateExports(payload) {
  const exports = {};
  const override = ['true', '1', 'yes', 'on'].includes(
    (process.env.AWS_SECRETS_OVERRIDE || '').trim().toLowerCase(),
  );
  for (const [key, raw] of Object.entries(payload)) {
    if (raw === null || raw === undefined) continue;
    const value = coerceSecretValue(raw);
    if (value === '') continue;
    const aliases = aliasesFor(key);
    if (!override && aliases.some(alias => ENV_NAME_RE.test(alias) && hasExistingEnvValue(alias))) continue;
    for (const alias of aliases) {
      if (!ENV_NAME_RE.test(alias)) continue;
      if (!override && hasExistingEnvValue(alias)) continue;
      if (!(alias in exports)) exports[alias] = value;
    }
  }
  return exports;
}

async function loadSecret(client, GetSecretValueCommand, secretId) {
  try {
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    const raw = response.SecretString;
    if (!raw) { log(`secret ${secretId} has no SecretString`); return { exports: {}, fatal: false }; }
    let payload;
    try { payload = JSON.parse(raw); }
    catch { log(`secret ${secretId} is not JSON; skipped`); return { exports: {}, fatal: false }; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      log(`secret ${secretId} is not a JSON object; skipped`);
      return { exports: {}, fatal: false };
    }
    const exports = candidateExports(payload);
    log(`loaded ${Object.keys(exports).length} env values from ${secretId}`);
    return { exports, fatal: false };
  } catch (err) {
    if (err?.name === 'ResourceNotFoundException') {
      log(`secret ${secretId} not found; skipped`);
      return { exports: {}, fatal: false };
    }
    log(`secret ${secretId} unavailable: ${err?.name || err?.message || err}`);
    // AccessDenied / auth errors will repeat identically for every other secret;
    // stop iterating and hint that env-injection deploys should set USE_AWS_SECRETS=false.
    const fatal = ['AccessDeniedException', 'UnrecognizedClientException', 'CredentialsProviderError', 'ExpiredTokenException'].includes(err?.name);
    return { exports: {}, fatal };
  }
}

export async function hydrateFromAwsSecrets() {
  const mode = (process.env.USE_AWS_SECRETS || 'auto').trim().toLowerCase();
  log(`USE_AWS_SECRETS=${mode || '(empty)'} env=${deployEnv()} region=${process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'}`);
  if (!shouldLoad()) {
    log(`AWS Secrets Manager skipped for env=${deployEnv()} (set USE_AWS_SECRETS=true to force)`);
    return {};
  }
  let clientMod;
  try {
    clientMod = await import('@aws-sdk/client-secrets-manager');
  } catch (err) {
    log(`@aws-sdk/client-secrets-manager unavailable: ${err?.message || err}`);
    return {};
  }
  const { SecretsManagerClient, GetSecretValueCommand } = clientMod;
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const client = new SecretsManagerClient({ region });
  const combined = {};
  for (const secretId of secretIds()) {
    const { exports, fatal } = await loadSecret(client, GetSecretValueCommand, secretId);
    for (const [key, value] of Object.entries(exports)) {
      if (!(key in combined)) combined[key] = value;
    }
    if (fatal) {
      log(`stopping hydration after auth failure; set USE_AWS_SECRETS=false when secrets are injected by the deploy (e.g. k8s envFrom)`);
      break;
    }
  }
  for (const [key, value] of Object.entries(combined)) {
    if (!hasExistingEnvValue(key)) process.env[key] = value;
  }
  log(`hydration complete: ${Object.keys(combined).length} keys applied`);
  return combined;
}
