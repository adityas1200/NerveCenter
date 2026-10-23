import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const WINDOWS_RENAME_RETRIES = 40;
const WINDOWS_RENAME_DELAY_MS = 15;
const WINDOWS_RENAME_MAX_DELAY_MS = 100;
const writeLocks = new Map();

function isTransientRenameError(error) {
  return ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(error?.code);
}

async function replaceFile(tmp, file) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (error) {
      if (error?.code === 'ENOENT' && attempt < WINDOWS_RENAME_RETRIES) {
        // A concurrent cleanup or endpoint scanner can race a temporary file on
        // Windows. Recreate it from the still-caller-owned payload in writeJson.
        throw Object.assign(error,{retryWrite:true});
      }
      if (process.platform !== 'win32' || !isTransientRenameError(error) || attempt >= WINDOWS_RENAME_RETRIES) {
        throw error;
      }
      const delay = Math.min(WINDOWS_RENAME_MAX_DELAY_MS, WINDOWS_RENAME_DELAY_MS * (attempt + 1));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
  const previous = writeLocks.get(file) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    await ensureDir(path.dirname(file));
    for(let attempt=0;attempt<3;attempt+=1){
      const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
      try {
        await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await replaceFile(tmp, file);
        return;
      } catch (error) {
        await fs.rm(tmp, { force: true }).catch(() => {});
        if(!error?.retryWrite||attempt===2)throw error;
      }
    }
  });
  writeLocks.set(file, current);
  try {
    await current;
  } finally {
    if (writeLocks.get(file) === current) writeLocks.delete(file);
  }
}

export async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export function safeJoin(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Path escapes allowed root');
  }
  return resolved;
}
