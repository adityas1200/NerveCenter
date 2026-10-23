import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { TemplateService, TEMPLATE_FORMATS } from '../src/documents/template-service.mjs';
import { tempDir } from './helpers.mjs';

const tmp = await tempDir('nc-templates-');

test('presets list every format with at least one option, name and description', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-presets') });
  const templates = new TemplateService({ workspace });
  const presets = templates.presets();
  assert.deepEqual(Object.keys(presets).sort(), [...TEMPLATE_FORMATS].sort());
  for (const format of TEMPLATE_FORMATS) {
    assert.ok(presets[format].length >= 3, `${format} should offer a few presets`);
    for (const preset of presets[format]) { assert.ok(preset.id); assert.ok(preset.name); assert.ok(preset.description); }
  }
});

test('upload saves the file under templates/<format> and returns its metadata', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-upload') });
  const templates = new TemplateService({ workspace });
  const fileBase64 = Buffer.from('not a real docx, just bytes').toString('base64');
  const result = await templates.upload({ format: 'word', fileBase64, fileName: 'Client Brand.docx', user: { id: 'admin.local' } });
  assert.equal(result.format, 'word');
  assert.equal(result.kind, 'custom');
  assert.equal(result.originalName, 'Client Brand.docx');
  assert.equal(result.uploadedBy, 'admin.local');
  const dir = path.join(workspace.templatesDir, 'word');
  const files = await fs.readdir(dir);
  assert.deepEqual(files, [result.fileName]);
  assert.equal((await fs.readFile(path.join(dir, result.fileName), 'utf8')), 'not a real docx, just bytes');
});

test('a second upload for the same format replaces the first, never accumulating files', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-replace') });
  const templates = new TemplateService({ workspace });
  await templates.upload({ format: 'html', fileBase64: Buffer.from('v1').toString('base64'), fileName: 'a.html' });
  await templates.upload({ format: 'html', fileBase64: Buffer.from('v2').toString('base64'), fileName: 'b.html' });
  const files = await fs.readdir(path.join(workspace.templatesDir, 'html'));
  assert.equal(files.length, 1);
  assert.match(files[0], /b\.html$/);
});

test('upload refuses an unknown format, a mismatched extension and an empty file', async () => {
  const workspace = await createWorkspace({ dir: path.join(tmp, 'ws-refuse') });
  const templates = new TemplateService({ workspace });
  await assert.rejects(templates.upload({ format: 'pdf', fileBase64: 'x', fileName: 'a.pdf' }), /format must be one of/);
  await assert.rejects(templates.upload({ format: 'word', fileBase64: Buffer.from('x').toString('base64'), fileName: 'a.pptx' }), /must be a \.docx file/);
  await assert.rejects(templates.upload({ format: 'word', fileBase64: '', fileName: 'a.docx' }), /fileBase64 is required/);
});
