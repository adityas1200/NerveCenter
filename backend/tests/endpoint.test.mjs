import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeOrigin, isLoopbackHost, schemeForHost } from '../src/lib/endpoint.mjs';
import { normalizeServiceNowInstance, serviceNowBaseUrl } from '../src/connectors/servicenow/servicenow-service.mjs';
import { normalizeJiraSite } from '../src/connectors/jira/jira-service.mjs';
import { FileSecretStore } from '../src/secrets/secret-store.mjs';

test('system URLs: HTTPS anywhere, HTTP only on loopback', () => {
  assert.equal(normalizeOrigin('https://adb-123.azuredatabricks.net/'), 'https://adb-123.azuredatabricks.net');
  assert.equal(normalizeOrigin('company.atlassian.net'), 'https://company.atlassian.net');
  assert.equal(normalizeOrigin('http://127.0.0.1:8711'), 'http://127.0.0.1:8711');
  assert.equal(normalizeOrigin('http://localhost:8713/'), 'http://localhost:8713');
  assert.throws(() => normalizeOrigin('http://company.atlassian.net'), /HTTPS/);
  assert.throws(() => normalizeOrigin('https://user:pw@company.atlassian.net'), /credentials/);
  assert.throws(() => normalizeOrigin('', { label: 'Jira site' }), /Jira site is required/);
  assert.equal(isLoopbackHost('LOCALHOST'), true);
  assert.equal(isLoopbackHost('api.localhost'), true);
  assert.equal(isLoopbackHost('127.0.0.2'), true);
  assert.equal(isLoopbackHost('127.255.255.255'), true);
  assert.equal(isLoopbackHost('10.0.0.5'), false);
  assert.equal(isLoopbackHost('127.evil.example.com'), false);
  assert.equal(isLoopbackHost('127.0.0.1.evil'), false);
  assert.throws(() => normalizeOrigin('http://127.evil.example.com'), /HTTPS/);
  assert.throws(() => normalizeOrigin('http://127.0.0.1.evil'), /HTTPS/);
  assert.equal(schemeForHost('127.0.0.1:8712'), 'http'); assert.equal(schemeForHost('company.service-now.com'), 'https');
});

test('ServiceNow and Jira keep a loopback port and build the right base URL', () => {
  assert.equal(normalizeServiceNowInstance('company.service-now.com'), 'company.service-now.com');
  assert.equal(normalizeServiceNowInstance('https://company.service-now.com/'), 'company.service-now.com');
  assert.equal(normalizeServiceNowInstance('http://127.0.0.1:8712'), '127.0.0.1:8712');
  assert.equal(serviceNowBaseUrl('127.0.0.1:8712'), 'http://127.0.0.1:8712');
  assert.equal(serviceNowBaseUrl('company.service-now.com'), 'https://company.service-now.com');
  assert.throws(() => normalizeServiceNowInstance('https://company.service-now.com/api'), /bare HTTPS hostname/);
  assert.throws(() => normalizeServiceNowInstance('http://company.service-now.com'), /HTTPS/);
  assert.equal(normalizeJiraSite('http://127.0.0.1:8713'), 'http://127.0.0.1:8713');
  assert.throws(() => normalizeJiraSite('http://jira.internal'), /HTTPS/);
});

test('file secret store persists across instances', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-secrets-'));
  const file = path.join(dir, 'secrets.json');
  const store = new FileSecretStore(file);
  assert.equal(await store.get('connectors/jira/JIRA_API_TOKEN'), undefined);
  await store.set('connectors/jira/JIRA_API_TOKEN', 'abc');
  assert.equal(await new FileSecretStore(file).get('connectors/jira/JIRA_API_TOKEN'), 'abc');
  assert.deepEqual(await store.status('connectors/jira/JIRA_API_TOKEN'), { ref: 'connectors/jira/JIRA_API_TOKEN', present: true });
  assert.equal(await store.delete('connectors/jira/JIRA_API_TOKEN'), true);
  assert.equal(await store.delete('connectors/jira/JIRA_API_TOKEN'), false);
  await assert.rejects(store.set('x', ''), /secret value is required/);
  await fs.rm(dir, { recursive: true, force: true });
});
