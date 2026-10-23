import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceSync } from '../src/workspace/workspace-sync.mjs';
import { tempDir } from './helpers.mjs';

const tmp = await tempDir('nc-sync-');

/** In-memory S3: enough of ListObjectsV2 / GetObject / PutObject / DeleteObject for the sync. */
function fakeS3() {
  const objects = new Map(); const calls = [];
  return {
    objects, calls,
    async send(command) {
      const name = command.constructor.name; const input = command.input; calls.push(name);
      if (name === 'ListObjectsV2Command') { const keys = [...objects.keys()].filter(key => key.startsWith(input.Prefix)).sort(); const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0; const page = keys.slice(start, start + 2); return { Contents: page.map(key => ({ Key: key, Size: objects.get(key).length, ETag: 'x' })), IsTruncated: start + 2 < keys.length, NextContinuationToken: String(start + 2) }; }
      if (name === 'GetObjectCommand') { const body = objects.get(input.Key); if (!body) throw new Error('NoSuchKey'); return { Body: { transformToByteArray: async () => body } }; }
      if (name === 'PutObjectCommand') { objects.set(input.Key, Buffer.from(input.Body)); return {}; }
      if (name === 'DeleteObjectCommand') { objects.delete(input.Key); return {}; }
      throw new Error(`Unexpected command ${name}`);
    },
  };
}

test('push uploads changed files, skips .git, the source mirror and the state file, and deletes removed files', async () => {
  const dir = path.join(tmp, 'ws-a'); await fs.mkdir(path.join(dir, 'knowledge', 'runbooks', '.git'), { recursive: true }); await fs.mkdir(path.join(dir, 'workflows'), { recursive: true });
  await fs.mkdir(path.join(dir, 'source', 'acme-widgets', '.git'), { recursive: true });
  await fs.writeFile(path.join(dir, 'operations.yaml'), 'team:\n  name: Ops\n'); await fs.writeFile(path.join(dir, 'workflows', 'daily.yaml'), 'name: daily\n');
  await fs.writeFile(path.join(dir, 'knowledge', 'runbooks', 'index.md'), '# Runbooks\n'); await fs.writeFile(path.join(dir, 'knowledge', 'runbooks', '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await fs.writeFile(path.join(dir, 'source', 'acme-widgets', 'app.js'), 'console.log("mirror");\n');
  const s3 = fakeS3(); const sync = new WorkspaceSync({ dir, bucket: 'bucket', prefix: '/nervecenter/', client: s3, log: {} });
  const first = await sync.push();
  assert.deepEqual(first, { uploaded: 3, deleted: 0 });
  assert.deepEqual([...s3.objects.keys()].sort(), ['nervecenter/workspace/knowledge/runbooks/index.md', 'nervecenter/workspace/operations.yaml', 'nervecenter/workspace/workflows/daily.yaml']);
  assert.deepEqual(await sync.push(), { uploaded: 0, deleted: 0 }, 'nothing changed, nothing uploaded');
  await new Promise(resolve => setTimeout(resolve, 20));
  await fs.writeFile(path.join(dir, 'operations.yaml'), 'team:\n  name: Data Operations\n'); await fs.rm(path.join(dir, 'workflows', 'daily.yaml'));
  const second = await sync.push();
  assert.deepEqual(second, { uploaded: 1, deleted: 1 });
  assert.equal(s3.objects.get('nervecenter/workspace/operations.yaml').toString(), 'team:\n  name: Data Operations\n');
  assert.equal(s3.objects.has('nervecenter/workspace/workflows/daily.yaml'), false);
});

test('restore fills an empty workspace from S3 and is a no-op when operations.yaml already exists', async () => {
  const s3 = fakeS3();
  for (const [key, body] of [['nervecenter/workspace/operations.yaml', 'team: {}\n'], ['nervecenter/workspace/.mcp.json', '{"mcpServers":{}}'], ['nervecenter/workspace/tasks/T-1001/rca.md', '# RCA\n'], ['nervecenter/workspace/knowledge/index.md', '# Bases\n'], ['nervecenter/workspace/.claude/skills/x/SKILL.md', '---\nname: x\n---\n']]) s3.objects.set(key, Buffer.from(body));
  const dir = path.join(tmp, 'ws-b');
  const sync = new WorkspaceSync({ dir, bucket: 'bucket', prefix: 'nervecenter', client: s3, log: {} });
  const result = await sync.restore();
  assert.equal(result.restored, 5);
  assert.equal(await fs.readFile(path.join(dir, 'tasks', 'T-1001', 'rca.md'), 'utf8'), '# RCA\n');
  assert.equal(await fs.readFile(path.join(dir, '.claude', 'skills', 'x', 'SKILL.md'), 'utf8'), '---\nname: x\n---\n');
  assert.ok(s3.calls.filter(name => name === 'ListObjectsV2Command').length >= 3, 'paginates the listing');
  assert.deepEqual(await sync.push(), { uploaded: 0, deleted: 0 }, 'restored files are already in sync');
  const again = await sync.restore();
  assert.equal(again.restored, 0); assert.match(again.skipped, /already present/);
});
