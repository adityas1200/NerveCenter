import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every test process gets a throwaway data root so it never touches repository data or .env.
if (!process.env.OPS_TEST_DATA_ROOT) {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nervecenter-backend-tests-'));
  process.env.OPS_TEST_DATA_ROOT = testRoot;
  process.env.OPS_RUNTIME_DIR = path.join(testRoot, 'runtime');
  process.env.OPS_WORKSPACE_DIR = path.join(testRoot, 'workspace');
  // Most existing API tests exercise the legacy PILOT project. Seed that fixture explicitly now that clean
  // deployments no longer create it; the clean-start test removes it before bootstrapping.
  fs.mkdirSync(process.env.OPS_RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.OPS_RUNTIME_DIR, 'projects.json'), JSON.stringify({
    projects: { pilot: { id: 'pilot', name: 'PILOT', slug: 'pilot', description: 'Test project', kind: 'normal', open: false, color: null, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'test' } },
    members: [], grants: [],
  }));
  process.on('exit', () => fs.rmSync(testRoot, { recursive: true, force: true }));
}
process.env.OPS_RBAC_USERS_FILE ||= path.join(process.env.OPS_TEST_DATA_ROOT, 'config', 'rbac-users.json');
// No admins are baked into the build, so the tests name the one they sign in as, and do not read
// the repository's admins.json.
process.env.OPS_ADMIN_LIST_FILE ||= path.join(process.env.OPS_TEST_DATA_ROOT, 'config', 'admins.json');
process.env.OPS_ADMIN_USER_IDS ||= 'mitesh.shinde@zs.com';

process.env.NODE_ENV = 'test';
process.env.OPS_IDENTITY_MODE = 'development';
process.env.OPS_METADATA_STORE = 'file';
process.env.OPS_SECRET_STORE = 'memory';
for (const key of ['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'SERVICENOW_INSTANCE', 'OPS_SERVICENOW_INSTANCE', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD', 'SNOWFLAKE_ACCOUNT', 'SNOWFLAKE_TOKEN', 'SNOWFLAKE_USER', 'DATABASE_URL', 'NC_DATABASE_URL']) delete process.env[key];
