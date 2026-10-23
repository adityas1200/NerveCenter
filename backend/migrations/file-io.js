import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Migrations ship beside the compiled backend, so their file helpers must ship here too.
export const ensureDir = dir => fs.mkdir(dir, { recursive: true });
export const exists = async file => fs.access(file).then(() => true, () => false);
export const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
