// Shared test helpers. Small and explicit; each test file imports only what it uses.
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileTaskStore } from '../src/tasks/task-store.mjs';
import { TaskRuntime } from '../src/tasks/task-runtime.mjs';
import { createWorkspace } from '../src/workspace/workspace.mjs';
import { systemScope } from '../src/projects/project-access.mjs';

/** A write-capable scope for the PILOT project, for tests of services and stores that sit below the API. */
export const pilot = systemScope('pilot');

/** Polls `predicate` (sync or async) until it is truthy; rejects after `ms`. */
export const wait = (predicate, ms = 10000, label = '') => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = async () => {
    if (await predicate()) return resolve();
    if (Date.now() - started > ms) return reject(new Error(`timed out${label ? ` waiting ${label}` : ''} :: ${predicate.toString().slice(0, 120)}`));
    setTimeout(tick, 20);
  };
  tick();
});

/** Creates a temp directory and removes it when the calling test file finishes. */
export async function tempDir(prefix, { maxRetries } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  test.after(() => fs.rm(dir, { recursive: true, force: true, ...(maxRetries ? { maxRetries } : {}) }));
  return dir;
}

/** True when `git` is installed; use as `{ skip: !hasGit && 'git is not installed' }`. */
export const hasGit = await promisify(execFile)('git', ['--version']).then(() => true).catch(() => false);

/** SDK stream messages as the Claude Agent SDK emits them; `extra` overrides any field. */
export const sdkInit = (sessionId, extra = {}) => ({ type: 'system', subtype: 'init', session_id: sessionId, tools: [], mcp_servers: [], ...extra });
export const sdkResult = (sessionId, result, extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0, usage: {}, num_turns: 1, duration_ms: 1, session_id: sessionId, ...extra });

/**
 * A stand-in SDK that answers every query with "Reply <n>" (new session per call). With `writeTool` it
 * also makes one change through the permission gate; `narrate` adds an assistant text event first.
 */
export function fakeSdk({ writeTool = null, narrate = false } = {}) {
  const calls = [];
  return {
    calls,
    query({ prompt, options }) {
      calls.push({ prompt, options });
      const n = calls.length;
      const session = `sess-${n}`;
      return (async function* () {
        yield sdkInit(session, { model: 'claude-test', tools: ['Read'], skills: [], plugins: [] });
        if (narrate) yield { type: 'assistant', session_id: session, parent_tool_use_id: null, message: { content: [{ type: 'text', text: `Reply ${n}` }] } };
        if (writeTool) {
          const decision = await options.canUseTool(writeTool, { issueKey: 'DATAOPS-1', body: 'note' }, { signal: options.abortController.signal });
          if (decision.behavior === 'allow') {
            yield { type: 'assistant', session_id: session, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: `tu-${n}`, name: writeTool, input: { issueKey: 'DATAOPS-1', body: 'note' } }] } };
            yield { type: 'user', session_id: session, parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: `tu-${n}`, content: 'ok' }] } };
          }
        }
        yield sdkResult(session, `Reply ${n}`, { total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 }, duration_ms: 50 });
      })();
    },
  };
}

/** A stand-in MCP SDK: `call(tool, args)` runs a registered tool and parses its JSON text reply. */
export const fakeMcpSdk = {
  tool: (name, description, shape, handler) => ({ name, description, shape, handler }),
  createSdkMcpServer: ({ name, tools }) => ({ name, tools, call: async (tool, args) => JSON.parse((await tools.find(item => item.name === tool).handler(args)).content[0].text) }),
};

/** A workspace + task store + TaskRuntime under `tmp`. `name` makes the directories predictable. */
export async function makeRuntime(tmp, sdk, { name = Math.random().toString(36).slice(2), ...runtimeOptions } = {}) {
  const workspace = await createWorkspace({ dir: path.join(tmp, `ws-${name}`) });
  const store = new FileTaskStore(path.join(tmp, `store-${name}`)); await store.init();
  const runtime = new TaskRuntime({ store, workspace, sdkLoader: async () => sdk, ...runtimeOptions });
  return { workspace, store, runtime };
}
