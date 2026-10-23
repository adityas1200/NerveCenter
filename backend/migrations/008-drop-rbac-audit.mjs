import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ADR 0003: the file-store twin of 008-drop-rbac-audit.sql. The RBAC audit log is removed, so its file goes too.
// It sat at OPS_RBAC_AUDIT_FILE, which every stack pointed beside the users file (the AWS compose stack, tests) or
// left at the default beside `data/config/rbac-users.json`. That variable is gone now, so both places are checked;
// the users file's own location keeps a test run away from the repository's data. The file store has no import
// marker, so nothing moves. A second run finds no file and changes nothing.
function auditFiles(dataDir) {
  const usersFile = process.env.OPS_RBAC_USERS_FILE ? path.resolve(process.env.OPS_RBAC_USERS_FILE) : path.join(dataDir, 'config', 'rbac-users.json');
  const legacy = process.env.OPS_RBAC_AUDIT_FILE ? path.resolve(process.env.OPS_RBAC_AUDIT_FILE) : null;
  return [...new Set([legacy, path.join(path.dirname(usersFile), 'rbac-audit.json')].filter(Boolean))];
}

export async function up({ dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data') } = {}) {
  for (const file of auditFiles(dataDir)) await fs.rm(file, { force: true });
}
