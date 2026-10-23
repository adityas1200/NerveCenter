import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyEnvDefaults, parseEnvDefaults } from '../src/env-defaults.mjs';
import { tempDir } from './helpers.mjs';

// On k8s the tracked .env.defaults reaches the backend only through this loader.

const tmp = await tempDir('nc-env-defaults-');

test('the file is parsed the way deploy-component.sh reads it', () => {
  assert.deepEqual(parseEnvDefaults(['# comment', '', 'A=1', '  B = two  ', 'C="quoted value"', "D='single'", 'E=', 'bad key=x', '=novalue', 'URL=https://x/y?a=b'].join('\n')), [
    ['A', '1'], ['B', 'two'], ['C', 'quoted value'], ['D', 'single'], ['E', ''], ['URL', 'https://x/y?a=b'],
  ]);
});

test('only unset variables are filled: whatever the platform set wins, including a deliberate blank', async () => {
  const file = path.join(tmp, '.env.defaults');
  await fs.writeFile(file, 'NC_DB_SCHEMA=nervecenter\ns3_bucket=dev-bucket\nAWS_REGION=us-east-1\n');
  // Sandbox sets NC_DB_SCHEMA= on purpose (a dedicated database); k8s sets AWS_REGION itself.
  const env = { NC_DB_SCHEMA: '', AWS_REGION: 'eu-west-1' };
  assert.deepEqual(applyEnvDefaults({ file, env }), ['s3_bucket']);
  assert.deepEqual(env, { NC_DB_SCHEMA: '', AWS_REGION: 'eu-west-1', s3_bucket: 'dev-bucket' });
});

test('no file means nothing to apply, not a crash', () => {
  const env = {};
  assert.deepEqual(applyEnvDefaults({ file: path.join(tmp, 'missing'), env }), []);
  assert.deepEqual(env, {});
});
