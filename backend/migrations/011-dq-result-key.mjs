import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { exists, readJson, writeJson } from './file-io.js';

// ADR-0006: the file-store twin of 011-dq-result-key.sql. Each project's `monitoring/<projectId>/dq.json` is re-keyed by
// execution identity (duplicates keep the newest `fetchedAt`), and its claimed occurrences and alert occurrences follow.
// The key is computed here, not imported, so later code changes cannot change what this migration did. A rerun changes nothing.
const resultKey = item => `dq-result:${createHash('sha256').update([item.tableId, item.checkId, item.executedAt].map(value => String(value ?? '')).join('\u001f')).digest('hex').slice(0, 40)}`;

export async function up({ runtimeDir }) {
  const root = path.join(runtimeDir, 'monitoring');
  if (!(await exists(root))) return;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name); const dqFile = path.join(dir, 'dq.json');
    if (!(await exists(dqFile))) continue;
    const doc = await readJson(dqFile); const moved = new Map(); const results = {};
    for (const [oldKey, item] of Object.entries(doc.results || {})) {
      const key = resultKey(item); if (key !== oldKey) moved.set(oldKey, key);
      const kept = results[key];
      if (!kept || String(item.fetchedAt || '') > String(kept.fetchedAt || '')) results[key] = { ...item, key };
    }
    if (!moved.size) continue;
    const occurrencesFile = path.join(dir, 'occurrences.json');
    if (await exists(occurrencesFile)) {
      const claimed = await readJson(occurrencesFile);
      for (const [oldKey, key] of moved) if (claimed[`dq:${oldKey}`] && !claimed[`dq:${key}`]) claimed[`dq:${key}`] = claimed[`dq:${oldKey}`];
      await writeJson(occurrencesFile, claimed);
    }
    const alertsFile = path.join(dir, 'alerts.json');
    if (await exists(alertsFile)) {
      const alerts = await readJson(alertsFile);
      for (const alert of Object.values(alerts.alerts || {})) {
        if (alert?.trigger !== 'dqFailed' || !Array.isArray(alert.occurrences)) continue;
        alert.occurrences = alert.occurrences.map(item => (moved.has(item?.resultKey) ? { ...item, resultKey: moved.get(item.resultKey), key: `dq:${moved.get(item.resultKey)}` } : item));
      }
      await writeJson(alertsFile, alerts);
    }
    await writeJson(dqFile, { ...doc, results });
  }
}
