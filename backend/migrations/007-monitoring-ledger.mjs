import path from 'node:path';
import { ensureDir } from './file-io.js';

// ADR-0002: the file-store twin of 007-monitoring-ledger.sql. The file store keeps each project's ledger under
// `<runtime>/monitoring/<projectId>/`, created on first write; this only makes the root folder. A second run changes nothing.
export async function up({ runtimeDir }) {
  await ensureDir(path.join(runtimeDir, 'monitoring'));
}
