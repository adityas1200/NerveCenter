import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskRuntime, summarizeResult, endsWithQuestion, reportFrom } from '../src/tasks/task-runtime.mjs';
import { classifyTool, describeTool } from '../src/tasks/permission-policy.mjs';
import { DEFAULT_TICKET_POLL_SECONDS, TicketTaskService } from '../src/tasks/ticket-tasks.mjs';
import { FileOperationsStore } from '../src/app/operations-store.mjs';
import { makeRuntime, sdkInit, sdkResult, tempDir, wait, pilot } from './helpers.mjs';

const tmp = await tempDir('nc-tasks-');
const user = { id: 'mitesh', name: 'Mitesh' };

test('automatic ticket sync defaults to 15 seconds', () => {
  const saved = process.env.OPS_TICKET_POLL_SECONDS;
  delete process.env.OPS_TICKET_POLL_SECONDS;
  try {
    const service = new TicketTaskService({ runtime: { on() {} } });
    assert.equal(DEFAULT_TICKET_POLL_SECONDS, 15);
    assert.equal(service.pollSeconds, 15);
  } finally {
    if (saved === undefined) delete process.env.OPS_TICKET_POLL_SECONDS; else process.env.OPS_TICKET_POLL_SECONDS = saved;
  }
});

test('the workspace sync interval controls scheduled ticket imports', async () => {
  let time = Date.parse('2026-09-28T09:00:00Z'); let sourceCalls = 0;
  const service = new TicketTaskService({
    store: {},
    runtime: { on() {} },
    operationsService: { async syncJira() { sourceCalls += 1; return { tickets: [] }; } },
    workspace: { async readOperations() { return { sync: { enabled: true, interval_seconds: 30 }, ticketing: { app: { sources: [{ platform: 'jira' }] } } }; } },
    clock: () => time,
  });

  await service.poll();
  time += 15_000;
  assert.deepEqual(await service.poll(), { skipped: 'not due' });
  time += 15_000;
  await service.poll();
  assert.equal(sourceCalls, 2);
});

// A stand-in for the Claude Agent SDK: emits init, text, one MCP write that goes through the
// permission gate, then a result with cost. Records the options it was called with.
function fakeSdk({ writeTool = 'mcp__atlassian__addCommentToJiraIssue', finalText = 'Comment added to DATAOPS-1854.\n\nDetails below.' } = {}) {
  const calls = [];
  return {
    calls,
    query({ prompt, options }) {
      calls.push({ prompt, options });
      return (async function* () {
        yield sdkInit('sess-1', { model: 'claude-test', tools: ['Read', writeTool], mcp_servers: [{ name: 'atlassian', status: 'connected' }], skills: ['operations-fleet:tickets'], plugins: [{ name: 'operations-fleet' }] });
        yield { type: 'assistant', session_id: 'sess-1', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Reading the ticket first.' }, { type: 'tool_use', id: 'tu-1', name: 'mcp__atlassian__getJiraIssue', input: { issueKey: 'DATAOPS-1854' } }] } };
        yield { type: 'user', session_id: 'sess-1', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: [{ type: 'text', text: '{"status":"Open"}' }] }] } };
        const decision = await options.canUseTool(writeTool, { issueKey: 'DATAOPS-1854', body: 'RCA summary' }, { signal: options.abortController.signal, decisionReason: 'Writes to Jira need approval' });
        if (decision.behavior === 'allow') {
          yield { type: 'assistant', session_id: 'sess-1', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu-2', name: writeTool, input: { issueKey: 'DATAOPS-1854', body: 'RCA summary' } }] } };
          yield { type: 'user', session_id: 'sess-1', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'tu-2', content: 'ok' }] } };
          yield sdkResult('sess-1', finalText, { total_cost_usd: 0.42, usage: { input_tokens: 1200, output_tokens: 300 }, num_turns: 3, duration_ms: 5200 });
        } else {
          yield sdkResult('sess-1', `Denied: ${decision.message}\nShould I draft the comment as a file instead?`, { total_cost_usd: 0.1, usage: { input_tokens: 500, output_tokens: 80 }, num_turns: 2, duration_ms: 1500 });
        }
      })();
    },
  };
}

const harness = sdk => makeRuntime(tmp, sdk, { maxConcurrent: 2 });

// Paths are POSIX-absolute: a 'C:/...' path is only absolute on Windows, so it never matched a task folder on macOS or Linux.
test('permission policy: reads pass, external writes ask, task-folder writes pass, read-only denies', () => {
  // These use permission "ask" (ask before every change) so they check what counts as a change.
  assert.equal(classifyTool('Read', { file_path: 'x' }, { permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('mcp__atlassian__searchJiraIssuesUsingJql', {}, { permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('mcp__atlassian__addCommentToJiraIssue', {}, { permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('mcp__databricks__run_job', {}, { permission: 'read-only' }).verdict, 'deny');
  assert.equal(classifyTool('Write', { file_path: '/ws/tasks/T-1/rca.md' }, { taskDir: '/ws/tasks/T-1', permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('Write', { file_path: '/ws/operations.yaml' }, { taskDir: '/ws/tasks/T-1', permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('Bash', { command: 'ls -la knowledge' }, { permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('Bash', { command: 'rm -rf knowledge' }, { permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('Bash', { command: 'rm -rf knowledge' }, { permission: 'allow' }).verdict, 'allow');
  // PowerShell (the SDK's shell on Windows) follows the same rules; multi-statement listings stay read-only.
  assert.equal(classifyTool('PowerShell', { command: '$w="/ws"; Get-ChildItem -Force $w | Select-Object Name; "--- mcp ---"; if (Test-Path "$w/.mcp.json") { Get-Content "$w/.mcp.json" }' }, { permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('PowerShell', { command: 'Get-Content operations.yaml | Out-File copy.yaml' }, { permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('PowerShell', { command: 'Remove-Item -Recurse knowledge' }, { permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('PowerShell', { command: 'python scripts/check_workspace.py .' }, { permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('Bash', { command: 'curl -s -H "Authorization: Bearer $TOKEN" "$DATABRICKS_HOST/api/2.2/jobs/runs/list?limit=5"' }, { permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('Bash', { command: 'curl -s -X POST -d "{}" "$JIRA_URL/rest/api/3/issue/CDO-1/comment"' }, { permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('Bash', { command: 'curl -s "$DATABRICKS_HOST/api/2.2/jobs/list" > jobs.json' }, { permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('PowerShell', { command: 'Invoke-RestMethod -Uri "$env:JIRA_URL/rest/api/3/myself" -Headers $h' }, { permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('PowerShell', { command: 'Invoke-RestMethod -Method Post -Uri "$env:JIRA_URL/rest/api/3/issue" -Body $b' }, { permission: 'ask' }).verdict, 'ask');
  assert.equal(describeTool('PowerShell', { command: 'Get-ChildItem\n  -Force' }), 'Run command: Get-ChildItem -Force');
  // Inside its own task folder the agent may create folders and redirect output; POST-based reads (SQL statements, Jira search) count as reads.
  const inTask = { taskDir: '/ws/tasks/T-1003' };
  assert.equal(classifyTool('Bash', { command: 'mkdir -p tasks/T-1003 && curl -s -X POST "$DATABRICKS_HOST/api/2.0/sql/statements" -H "Authorization: Bearer $DATABRICKS_TOKEN" -d "{\\"statement\\":\\"SELECT * FROM commercial.ops_monitoring.dq_results LIMIT 5\\",\\"warehouse_id\\":\\"wh\\"}" > tasks/T-1003/dq.json' }, { ...inTask, permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('Bash', { command: 'curl -s -X POST "$DATABRICKS_HOST/api/2.0/sql/statements" -d "{\\"statement\\":\\"DELETE FROM commercial.gold.dim_hcp\\"}"' }, { ...inTask, permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('Bash', { command: 'curl -s -X POST "$JIRA_URL/rest/api/3/search/jql" -d "{\\"jql\\":\\"project = CDO\\"}"' }, { ...inTask, permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('Bash', { command: 'curl -s "$DATABRICKS_HOST/api/2.2/jobs/list" > knowledge/jobs.json' }, { ...inTask, permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('Bash', { command: 'mkdir -p knowledge/new-base' }, { ...inTask, permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('PowerShell', { command: 'New-Item -ItemType Directory -Force -Path /ws/tasks/T-1003/evidence; Get-ChildItem /ws/tasks/T-1003' }, { ...inTask, permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('Bash', { command: 'cd "/ws" && mkdir -p tasks/T-1003 && for j in 740 732; do echo "=== job $j ==="; curl -s -H "Authorization: Bearer $T" "$DATABRICKS_HOST/api/2.2/jobs/runs/list?job_id=$j&limit=5" | head -c 2000; done' }, { ...inTask, permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('Bash', { command: 'for f in *.md; do rm "$f"; done' }, { ...inTask, permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('Bash', { command: 'echo "=== members ==="; curl -s -m 15 "http://127.0.0.1:8714/identity/groups" | tr \',\' \'\\n\' | grep -A0 -E "analytics-readers|memberCount" | head -20' }, { ...inTask, permission: 'ask' }).verdict, 'allow', 'pipes inside quotes are not statement breaks');
  assert.equal(classifyTool('Bash', { command: 'echo "a|b" | grep "x;y" && rm -rf knowledge' }, { ...inTask, permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('Bash', { command: 'curl -s -o /dev/null -w "HTTP %{http_code}\\n" "http://127.0.0.1:8714/docs/file/x.csv"' }, { ...inTask, permission: 'ask' }).verdict, 'allow', 'discarding the body is not a write');
  assert.equal(classifyTool('Bash', { command: 'curl -s -o report.csv "http://127.0.0.1:8714/docs/file/x.csv"' }, { ...inTask, permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('Bash', { command: 'cd "/x/repo" && git log --oneline -8 && echo "--- diff ---" && diff contracts/v7.json contracts/v8.json' }, { ...inTask, permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('Bash', { command: 'sed -n 1,20p operations.yaml' }, { ...inTask, permission: 'ask' }).verdict, 'allow');
  assert.equal(classifyTool('Bash', { command: 'sed -i "s/a/b/" operations.yaml' }, { ...inTask, permission: 'ask' }).verdict, 'ask');
  assert.equal(classifyTool('Bash', { command: `curl -s -X POST -H "Authorization: Bearer $T" "$DATABRICKS_HOST/api/2.0/sql/statements" -d '{"warehouse_id":"'"$W"'","statement":"SELECT run_at, count(*) AS n FROM commercial.ops_monitoring.dq_results WHERE run_at >= '\\''2026-09-21'\\'' AND n > 5 GROUP BY run_at"}'` }, { ...inTask, permission: 'ask' }).verdict, 'allow', 'comparisons inside SQL are not redirects');
  assert.equal(describeTool('mcp__atlassian__addCommentToJiraIssue', { issueKey: 'DATAOPS-1854' }), 'atlassian · add Comment To Jira Issue DATAOPS-1854');
  assert.equal(summarizeResult('## Root cause\n**Schema drift** in `customer_events`.'), 'Root cause');
  // The report keeps the opening prose whole and stops at the first heading, list or table.
  assert.equal(reportFrom('**Schema drift** in `customer_events`; the merge step fails.\nThe fix is a contract change.\n\nNobody is blocked yet.\n\n## Evidence\n| a | b |'), 'Schema drift in customer_events; the merge step fails. The fix is a contract change.\n\nNobody is blocked yet.');
  assert.equal(reportFrom('Done.\n\n1. First step\n2. Second step'), 'Done.');
  assert.ok(reportFrom('word '.repeat(200)).length <= 700);
  assert.equal(endsWithQuestion('Done.\nShall I create the PR?'), true);
});

test('policy permission: the workspace policy decides per category; reads and routine writes just run', () => {
  const taskDir = path.resolve('/ws/tasks/T-7'); const opts = extra => ({ taskDir, permission: 'policy', ...extra });
  // Reads of every shape run without asking (these are the commands a real chat needed 13 approvals for).
  assert.equal(classifyTool('Bash', { command: 'cd tasks/T-7 && python -c "\nimport json\nd=json.load(open(\'a.json\'))\nprint(d)"' }, opts()).verdict, 'allow');
  assert.equal(classifyTool('Bash', { command: 'curl -s -X POST "$DATABRICKS_HOST/api/2.0/sql/statements" -H "Authorization: Bearer $T" -d "{\\"statement\\":\\"SELECT * FROM x WHERE a >= 5\\"}" | python -c "import json,sys; print(json.load(sys.stdin))"' }, opts()).verdict, 'allow');
  assert.equal(classifyTool('Bash', { command: 'curl -s -u "$U:$P" "$SN/api/now/table/incident?sysparm_limit=5" -o tasks/T-7/sn.json' }, opts()).verdict, 'allow');
  assert.equal(classifyTool('mcp__nervecenter__list_tickets', { status: 'open' }, opts()).verdict, 'allow');
  // Ordinary changes run under the default policy; sensitive ones ask.
  assert.equal(classifyTool('mcp__atlassian__addCommentToJiraIssue', { issueKey: 'CDO-1' }, opts()).verdict, 'allow');
  assert.equal(classifyTool('mcp__nervecenter__comment_on_ticket', { ticketId: 'T-1', text: 'x' }, opts()).verdict, 'allow');
  assert.equal(classifyTool('mcp__nervecenter__set_ticket_status', { ticketId: 'T-1', status: 'resolved' }, opts()).category, 'ticket_writes');
  assert.equal(classifyTool('mcp__nervecenter__set_ticket_status', { ticketId: 'T-1', status: 'resolved' }, opts()).verdict, 'ask');
  assert.equal(classifyTool('Bash', { command: 'curl -s -X POST "http://127.0.0.1:8714/mail/send" -d @mail.json' }, opts()).category, 'email_send');
  assert.equal(classifyTool('Bash', { command: 'curl -s -X POST "http://127.0.0.1:8714/identity/groups/analytics-readers/members" -d "{}"' }, opts()).category, 'privileged_access');
  assert.equal(classifyTool('Bash', { command: 'curl -s -X POST "$DATABRICKS_HOST/api/2.2/jobs/run-now" -d "{\\"job_id\\":731}"' }, opts()).category, 'production_changes');
  assert.equal(classifyTool('Bash', { command: 'curl -s -X POST "$DATABRICKS_HOST/api/2.0/sql/statements" -d "{\\"statement\\":\\"DELETE FROM gold.x\\"}"' }, opts()).category, 'production_changes');
  assert.equal(classifyTool('Bash', { command: 'curl -s -X POST "$DATABRICKS_HOST/api/2.0/sql/statements" -d "{\\"statement\\":\\"GRANT SELECT ON TABLE x TO `a@b`\\"}"' }, opts()).category, 'privileged_access');
  assert.equal(classifyTool('Bash', { command: 'cd /repo && git push origin ticket/CDO-1' }, opts()).category, 'production_changes');
  assert.equal(classifyTool('Bash', { command: 'curl -s -X POST "$JIRA_URL/rest/api/3/issue/CDO-1/transitions" -d "{}"' }, opts()).category, 'ticket_writes');
  assert.equal(classifyTool('Write', { file_path: path.resolve('/ws/operations.yaml') }, opts()).category, 'workspace_changes');
  assert.equal(classifyTool('Write', { file_path: path.resolve('/ws/tasks/T-7/report.md') }, opts()).verdict, 'allow');
  assert.equal(classifyTool('Bash', { command: 'python -c "import requests; requests.post(\'https://x/api/now/table/incident\', json={})"' }, opts()).category, 'ticket_writes');
  // The workspace policy overrides the defaults, and read-only still denies every change.
  assert.equal(classifyTool('Bash', { command: 'curl -X POST https://x/mail/send -d a' }, opts({ policy: { email_send: 'allow' } })).verdict, 'allow');
  assert.equal(classifyTool('mcp__atlassian__addCommentToJiraIssue', {}, opts({ policy: { default_write: 'deny' } })).verdict, 'deny');
  assert.equal(classifyTool('mcp__atlassian__addCommentToJiraIssue', {}, opts({ permission: 'read-only' })).verdict, 'deny');
});

test('a task runs the plugin session, pauses on a write, resumes after approval, records cost', async () => {
  const sdk = fakeSdk(); const { runtime, store, workspace } = await harness(sdk);
  const task = await runtime.startTask({ scope: pilot, type: 'adhoc', prompt: 'Add the RCA summary to DATAOPS-1854', user, permission: 'ask', context: { page: { name: 'Tickets', path: '/tickets' } } });
  assert.equal(task.id, 'T-1001'); assert.equal(task.title, 'Add the RCA summary to DATAOPS-1854'); assert.equal(task.status, 'queued');
  await wait(async () => (await store.getTask(task.id)).status === 'waiting', 10000, 'first approval pending');
  const pending = await store.listInbox(pilot, { status: 'pending', kind: 'approval' });
  assert.equal(pending.length, 1); assert.equal(pending[0].taskId, task.id); assert.match(pending[0].title, /add Comment To Jira Issue DATAOPS-1854/); assert.equal(pending[0].tool.name, 'mcp__atlassian__addCommentToJiraIssue');
  assert.equal((await store.getTask(task.id)).pendingApprovalId, pending[0].id);
  await assert.rejects(runtime.sendMessage(task.id, user, 'hurry up'), /waiting for an approval/);
  await runtime.decideApproval(pending[0].id, 'approved', user);
  await wait(async () => (await store.getTask(task.id)).status === 'done', 10000, 'first run done');
  const finished = await runtime.getTask(task.id, { includeEvents: true });
  assert.equal(finished.summary, 'Comment added to DATAOPS-1854.'); assert.equal(finished.sessionId, 'sess-1');
  assert.deepEqual(finished.cost, { totalUsd: 0.42, inputTokens: 1200, outputTokens: 300, turns: 3, durationMs: 5200, runs: 1 });
  assert.deepEqual(finished.events.map(event => event.type), ['user.message', 'session.init', 'assistant.text', 'tool.use', 'tool.result', 'approval.requested', 'approval.decided', 'tool.use', 'tool.result', 'result']);
  assert.equal(finished.events.find(event => event.type === 'session.init').skills[0], 'operations-fleet:tickets');
  const notifications = await store.listInbox(pilot, { kind: 'notification' });
  assert.equal(notifications.length, 0, 'a quick chat reply is read in the chat, not announced in the Inbox');
  const decided = await store.getInboxItem(pending[0].id); assert.equal(decided.status, 'approved'); assert.equal(decided.decidedBy.id, 'mitesh');
  // SDK options: plugin loaded, orchestrator in the system prompt, workspace as cwd, page context
  const options = sdk.calls[0].options;
  assert.equal(options.cwd, workspace.dir); assert.deepEqual(options.plugins, [{ type: 'local', path: runtime.pluginDir }]); assert.deepEqual(options.settingSources, ['project']);
  assert.equal(options.systemPrompt.preset, 'claude_code'); assert.match(options.systemPrompt.append, /Own the user conversation from request to result/); assert.match(options.systemPrompt.append, /task T-1001/); assert.match(options.systemPrompt.append, /Your name is Sonic/);
  // The screen travels with the message, so the system prompt stays the same from message to message (cached).
  assert.match(sdk.calls[0].prompt, /<task_context>[\s\S]*Page: Tickets \(\/tickets\)[\s\S]*<\/task_context>/); assert.doesNotMatch(options.systemPrompt.append, /Page: Tickets/);
  assert.equal(options.permissionMode, 'default'); assert.equal(options.resume, undefined);
  // follow-up resumes the same session
  await runtime.sendMessage(task.id, user, 'Now tell me what changed.');
  await wait(async () => sdk.calls.length === 2 && (await store.getTask(task.id)).status === 'waiting');
  const [second] = await store.listInbox(pilot, { status: 'pending', kind: 'approval' });
  await runtime.decideApproval(second.id, 'approved', user);
  await wait(async () => (await store.getTask(task.id)).status === 'done', 10000, 'follow-up done');
  assert.equal(sdk.calls[1].options.resume, 'sess-1'); assert.equal((await store.getTask(task.id)).cost.runs, 2);
  // A follow-up may widen the permission: with `allow` the same write no longer pauses, and the change is on record.
  await runtime.sendMessage(task.id, user, 'Now add it for real', { permission: 'allow' });
  await wait(async () => { const current = await store.getTask(task.id); return current.status === 'done' && current.cost.runs === 3; }, 10000, 'widened run done');
  const widened = await runtime.getTask(task.id, { includeEvents: true });
  assert.equal(widened.permission, 'allow');
  assert.ok(widened.events.some(event => event.type === 'status' && event.title === 'Permission changed to allow'));
  assert.equal((await store.listInbox(pilot, { kind: 'approval' })).length, 2, 'the widened run needed no approval'); assert.equal(sdk.calls.length, 3);
  await assert.rejects(runtime.sendMessage(task.id, user, 'x', { permission: 'everything' }), /permission must be/);
});

test('a session lost to a restart is dropped and the task retries once as a new session', async () => {
  const sdk = {
    calls: [],
    query({ prompt, options }) {
      sdk.calls.push({ prompt, options });
      return (async function* () {
        // The SDK's own session transcript doesn't survive a redeploy; the sessionId we saved for `resume` does.
        if (options.resume) throw new Error(`Claude Code returned an error result: No conversation found with session ID: ${options.resume}`);
        yield sdkInit('sess-fresh', { model: 'claude-test', tools: [], mcp_servers: [], skills: [], plugins: [] });
        yield sdkResult('sess-fresh', 'Back online.', { total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 }, duration_ms: 50 });
      })();
    },
  };
  const { runtime, store } = await harness(sdk);
  const task = await runtime.startTask({ scope: pilot, type: 'adhoc', prompt: 'hello', user, permission: 'ask', notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'done', 10000, 'first run done');
  assert.equal(sdk.calls[0].options.resume, undefined);
  // Simulate what a restart leaves behind: a sessionId on the task pointing at a session the SDK no longer has.
  await store.updateTask(task.id, { sessionId: 'sess-stale' });
  await runtime.sendMessage(task.id, user, 'continue after restart');
  await wait(async () => (await store.getTask(task.id)).status === 'done' && sdk.calls.length === 3, 10000, 'retried without resume');
  assert.equal(sdk.calls[1].options.resume, 'sess-stale', 'first attempt tries to resume the stale session');
  assert.equal(sdk.calls[2].options.resume, undefined, 'second attempt starts fresh instead of failing the task');
  const finished = await runtime.getTask(task.id, { includeEvents: true });
  assert.equal(finished.sessionId, 'sess-fresh'); assert.equal(finished.summary, 'Back online.'); assert.equal(finished.status, 'done');
  assert.ok(finished.events.some(event => event.type === 'status' && event.title === 'Starting a new session'));
});

test('denied approval, questions, read-only tasks and cancellation', async () => {
  const sdk = fakeSdk(); const { runtime, store } = await harness(sdk);
  const task = await runtime.startTask({ scope: pilot, type: 'ticket', prompt: 'Comment on DATAOPS-1854', user, permission: 'ask', notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'waiting', 10000, 'first approval pending');
  const [approval] = await store.listInbox(pilot, { status: 'pending', kind: 'approval' });
  await runtime.decideApproval(approval.id, 'denied', user);
  await wait(async () => ['waiting', 'done'].includes((await store.getTask(task.id)).status) && !(await store.getTask(task.id)).pendingApprovalId);
  const after = await store.getTask(task.id);
  assert.equal(after.status, 'waiting'); // the agent ended with a question
  const questions = await store.listInbox(pilot, { kind: 'question' }); assert.equal(questions.length, 1); assert.match(questions[0].title, /draft the comment as a file/);
  await assert.rejects(runtime.decideApproval(approval.id, 'approved', user), /already denied/);

  const readOnly = await runtime.startTask({ scope: pilot, prompt: 'Investigate only', user, permission: 'read-only', notify: false });
  await wait(async () => ['done', 'waiting'].includes((await store.getTask(readOnly.id)).status));
  const events = await store.listEvents(readOnly.id);
  assert.ok(events.some(event => event.type === 'approval.denied' && /read-only/.test(event.detail)));
  assert.equal((await store.listInbox(pilot, { kind: 'approval', taskId: readOnly.id })).length, 0);

  const slow = { query: ({ options }) => (async function* () { yield sdkInit('s'); await new Promise((resolve, reject) => { options.abortController.signal.addEventListener('abort', () => reject(new Error('aborted'))); }); })() };
  const runtime2 = new TaskRuntime({ store, workspace: runtime.workspace, sdkLoader: async () => slow });
  const running = await runtime2.startTask({ scope: pilot, prompt: 'never ends', user });
  await wait(async () => (await store.getTask(running.id)).status === 'running');
  await runtime2.cancel(running.id, user);
  assert.equal((await store.getTask(running.id)).status, 'cancelled');
  await assert.rejects(runtime2.sendMessage(running.id, user, 'hello'), /cancelled/);
});

test('messages sent while the agent works are queued and run afterwards', async () => {
  // The first step is held open so the task is still running when the second message arrives.
  let release; const gate = new Promise(resolve => { release = resolve; }); const calls = [];
  const sdk = { calls, query: ({ prompt }) => { calls.push({ prompt }); const n = calls.length; return (async function* () { yield sdkInit(`s-${n}`); if (n === 1) await gate; yield sdkResult(`s-${n}`, `Reply ${n}`); })(); } };
  const { runtime, store } = await harness(sdk);
  const task = await runtime.startTask({ scope: pilot, prompt: 'first', user, permission: 'allow', notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'running');
  const queued = await runtime.sendMessage(task.id, user, 'second');
  assert.equal(queued.queued, true); release();
  await wait(async () => sdk.calls.length === 2 && (await store.getTask(task.id)).status === 'done');
  assert.equal(sdk.calls[1].prompt, 'second');
  assert.equal((await store.listEvents(task.id)).filter(event => event.type === 'user.message').length, 2);
});

test('ticket tasks: one task per ticket, state mirrored onto the ticket, poller respects the cap', async () => {
  const sdk = fakeSdk({ finalText: 'Schema drift in customer_events; the merge step fails on the new column.\n\nNext: update the transform.' });
  const { runtime, store, workspace } = await harness(sdk);
  const tickets = new FileOperationsStore(path.join(tmp, `tickets-${Math.random().toString(36).slice(2)}`)); await tickets.init();
  const mk = async (id, priority) => tickets.createTicket({ projectId: 'pilot', ticketId: id, title: `Ticket ${id}`, status: 'open', priority, source: 'servicenow', creator: { id: 'servicenow', name: 'ServiceNow' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), externalReference: { system: 'servicenow', sysId: id, number: `INC-${id}` } });
  await mk('OPS-1', 'critical'); await mk('OPS-2', 'high'); await mk('OPS-3', 'low');
  const operationsService = { syncServiceNow: async () => ({ tickets: await tickets.listTickets(pilot) }) };
  await workspace.setSection('ticketing', { platform: 'servicenow', sources: [{ platform: 'servicenow', auto_create_tasks: true, max_concurrent_tasks: 2, filters: { limit: 10 } }] });
  const service = new TicketTaskService({ store: tickets, runtime, operationsService, workspace, pollSeconds: 0 });

  const first = await service.ensureTask('OPS-1', { user, permission: 'ask' });
  assert.equal(first.created, true); assert.equal(first.task.type, 'ticket'); assert.equal(first.task.context.ticket.externalReference.number, 'INC-OPS-1');
  assert.equal((await tickets.getTicket('OPS-1')).taskId, first.task.id);
  const again = await service.ensureTask('OPS-1', { user });
  assert.equal(again.created, false); assert.equal(again.task.id, first.task.id);
  assert.ok((await tickets.getTicket('OPS-1')).activity.some(event => event.type === 'task.started'));

  const polled = await service.poll({ force: true });
  assert.equal(polled.created.length, 1, 'cap of 2 with one already running leaves one slot');
  assert.equal(polled.created[0].ticketId, 'OPS-2', 'highest priority first');
  assert.equal((await service.poll({ force: true })).created.length, 0, 'the cap is full');

  // the write in the fake SDK needs approval for OPS-1 (ask); approve it and let it finish
  await wait(async () => (await store.listInbox(pilot, { status: 'pending', kind: 'approval' })).length >= 1, 10000, 'approval pending');
  for (const item of await store.listInbox(pilot, { status: 'pending', kind: 'approval' })) await runtime.decideApproval(item.id, 'approved', user);
  await wait(async () => (await store.getTask(first.task.id)).status === 'done', 10000, `first task done (now ${JSON.stringify(await store.getTask(first.task.id))})`);
  await wait(async () => { const t = await tickets.getTicket('OPS-1'); return t.taskStatus === 'done' && (t.activity || []).some(event => event.type === 'task.done'); }, 10000, 'ticket mirrored done');
  const mirrored = await tickets.getTicket('OPS-1');
  assert.equal(mirrored.agentSummary, 'Schema drift in customer_events; the merge step fails on the new column.');
  assert.ok(mirrored.agentReport?.startsWith('Schema drift in customer_events'), `report mirrored: ${mirrored.agentReport}`);
  assert.ok(mirrored.taskFinishedAt, 'finish time mirrored');
  // A ticket from before the report existed gets it back from the task's last reply at start.
  await tickets.updateTicket('OPS-1', { agentReport: null, taskFinishedAt: null });
  await store.updateTask(first.task.id, { report: null });
  assert.deepEqual(await service.backfillReports(), { updated: 1 });
  const backfilled = await tickets.getTicket('OPS-1');
  assert.ok(backfilled.agentReport?.startsWith('Schema drift in customer_events'), `report backfilled: ${backfilled.agentReport}`);
  assert.ok(backfilled.taskFinishedAt, 'finish time backfilled');
  assert.ok(mirrored.activity.some(event => event.type === 'task.done'));
  await service.noteTicketChange('OPS-1', { title: 'Assigned to Mitesh', detail: 'by Mitesh' });
  const events = await store.listEvents(first.task.id);
  assert.ok(events.some(event => event.type === 'status' && event.title === 'Assigned to Mitesh'));
});

// An SDK whose first run holds until it is interrupted (aborted); every later run answers straight away.
function interruptibleSdk() {
  const calls = [];
  return {
    calls,
    query({ prompt, options }) {
      calls.push({ prompt, options });
      const first = calls.length === 1;
      return (async function* () {
        yield sdkInit('sess-9', { model: 'claude-test', tools: ['Read'], mcp_servers: [], skills: [], plugins: [] });
        if (first) { await new Promise(resolve => options.abortController.signal.addEventListener('abort', resolve, { once: true })); return; }
        yield sdkResult('sess-9', `Done: ${prompt}`, { total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 }, duration_ms: 100 });
      })();
    },
  };
}

test('the queue: messages typed while the agent works can be edited, dropped, or sent now by interrupting the step', async () => {
  const sdk = interruptibleSdk(); const { runtime, store } = await harness(sdk);
  const task = await runtime.startTask({ scope: pilot, prompt: 'first', user, permission: 'allow', notify: false });
  await wait(async () => (await store.getTask(task.id)).status === 'running' && sdk.calls.length === 1);

  const seen = []; runtime.on('task', updated => { if (updated.id === task.id) seen.push(updated.queue?.length ?? -1); });
  const a = await runtime.sendMessage(task.id, user, 'also check the payer file');
  const b = await runtime.sendMessage(task.id, user, 'and the IQVIA one');
  assert.equal(a.queued, true); assert.equal(a.message.text, 'also check the payer file'); assert.equal(a.message.actor.name, 'Mitesh');
  assert.deepEqual((await runtime.getTask(task.id)).queue.map(item => item.text), ['also check the payer file', 'and the IQVIA one']);
  assert.deepEqual(seen.filter((length, index) => index === 0 || length !== seen[index - 1]), [1, 2], 'every queue change is pushed as a task update');

  const edited = await runtime.editQueued(task.id, b.message.id, 'and the IQVIA file too');
  assert.equal(edited.message.text, 'and the IQVIA file too');
  await assert.rejects(runtime.editQueued(task.id, b.message.id, '   '), /text is required/);
  await runtime.removeQueued(task.id, a.message.id);
  await assert.rejects(runtime.removeQueued(task.id, a.message.id), /no longer queued/);
  assert.deepEqual((await runtime.getTask(task.id)).queue.map(item => item.text), ['and the IQVIA file too']);

  // Send now: the running step is interrupted and the same session continues with the message.
  const sent = await runtime.sendQueuedNow(task.id, b.message.id, user);
  assert.equal(sent.interrupted, true);
  await wait(async () => (await store.getTask(task.id)).status === 'done', 10000, 'for the interrupted task to finish');
  assert.equal(sdk.calls.length, 2); assert.equal(sdk.calls[1].prompt, 'and the IQVIA file too');
  assert.equal(sdk.calls[1].options.resume, 'sess-9', 'the same session continues');
  const events = await store.listEvents(task.id);
  assert.ok(events.some(event => event.type === 'status' && event.title === 'Interrupted' && /Mitesh sent a new message/.test(event.detail)));
  assert.deepEqual(events.filter(event => event.type === 'user.message').map(event => event.text), ['first', 'and the IQVIA file too']);
  assert.deepEqual((await runtime.getTask(task.id)).queue, []);
  assert.equal((await store.getTask(task.id)).summary, 'Done: and the IQVIA file too');
});

test('scheduled ticket polling stops while the app is inactive but a forced sync still runs', async () => {
  let workspaceReads = 0;
  const service = new TicketTaskService({
    store: {},
    runtime: { on() {} },
    operationsService: {},
    workspace: { async readOperations() { workspaceReads += 1; return { ticketing: { app: { sources: [] } } }; } },
    isAppActive: () => false,
    pollSeconds: 0,
  });

  assert.deepEqual(await service.poll(), { skipped: 'app inactive' });
  assert.equal(workspaceReads, 0);
  assert.deepEqual(await service.poll({ force: true }), { sources: [], created: [] });
  assert.equal(workspaceReads, 1);
});

test('the workspace auto-sync switch stops scheduled ticket imports', async () => {
  let sourceCalls = 0;
  const service = new TicketTaskService({
    store: {},
    runtime: { on() {} },
    operationsService: { async syncJira() { sourceCalls += 1; return { tickets: [] }; } },
    workspace: { async readOperations() { return { sync: { enabled: false }, ticketing: { app: { sources: [{ platform: 'jira' }] } } }; } },
    pollSeconds: 0,
  });

  assert.deepEqual(await service.poll(), { skipped: 'auto sync disabled' });
  assert.equal(sourceCalls, 0);
  await service.poll({ force: true });
  assert.equal(sourceCalls, 1);
});
