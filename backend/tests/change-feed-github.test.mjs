import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IntegrationSyncService } from '../src/sync/integration-sync.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mts';

test('SPEC-platform-13 FR-3: GitHub import publishes only after a project ticket is stored', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nc-pr-hints-'));
  try {
    const store = new FileOperationsStore(path.join(root, 'state.json'));
    await store.init();
    const hints = [];
    const operationsService = {
      async publishTicketChange(ticketId) {
        const ticket = await store.getTicket(ticketId);
        hints.push({ id: ticket.ticketId, projectId: ticket.projectId });
      },
    };
    const projectId = 'project-one';
    const workspace = {
      dir: path.join(root, 'workspace'),
      async readOperations() { return { source_control: { platform: 'github', repository: 'acme/app' } }; },
    };
    await fs.mkdir(workspace.dir, { recursive: true });
    const service = new IntegrationSyncService({
      operationsService, store, workspace, workspaces: { async for() { return workspace; } },
      projects: { async list() { return [{ id: projectId, kind: 'normal' }]; } },
      knowledge: null, databricksFailures: false,
      envProvider: async () => ({ GH_TOKEN: 'fake-project-token' }),
      runner: async command => ({ stdout: command === 'gh'
        ? JSON.stringify([{ number: 7, state: 'OPEN', title: 'Fix query', isDraft: false, url: 'https://github.com/acme/app/pull/7' }])
        : '' }),
    });

    await service.runGithub(projectId);
    await service.runGithub(projectId);
    assert.equal(hints.length, 2, 'create and update each publish one hint');
    assert.deepEqual(hints.map(hint => hint.projectId), [projectId, projectId]);
    assert.equal(hints[0].id, hints[1].id, 'the update uses the stored ticket identity');

    store.updateTicket = async () => { throw new Error('store update failed'); };
    await assert.rejects(() => service.runGithub(projectId), /store update failed/);
    assert.equal(hints.length, 2, 'a failed write does not publish');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
