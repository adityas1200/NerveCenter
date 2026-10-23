import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { classifyTool } from '../src/tasks/permission-policy.mjs';

// The shell gate fails closed: a program nobody listed as a reader counts as a change, so a
// read-only task cannot run it. The commands the agent actually uses to read (curl, PowerShell
// pipelines, SQL SELECTs through a helper function, heredoc Python) stay reads.

const taskDir = path.resolve('workspace-test', 'tasks', 'T-1');
const bash = command => classifyTool('Bash', { command }, { taskDir, permission: 'read-only' });

test('programs that may change something are not reads, even when the policy has no rule for them', () => {
  const cases = {
    'psql -c "UPDATE accounts SET tier = 1"': 'production_changes',
    'snowsql -q "DROP TABLE sales"': 'production_changes',
    'psql -c "GRANT SELECT ON t TO analyst"': 'privileged_access',
    'databricks api post /api/2.1/jobs/run-now --json \'{"job_id": 7}\'': 'production_changes',
    'gh api -X DELETE repos/acme/etl/git/refs/heads/old': 'default_write',
    'aws s3 rm s3://bucket/key': 'default_write',
    'kubectl delete pod etl-1': 'default_write',
    'terraform apply -auto-approve': 'default_write',
    'dbt run --select orders': 'default_write',
    'rid=$(curl -s -X POST https://adb.example.net/api/2.1/jobs/run-now -d \'{"job_id":1}\')': 'production_changes',
    'bash -c "psql -c \'DELETE FROM t\'"': 'production_changes',
    '[System.IO.File]::WriteAllText("C:/x.txt", "a")': 'default_write',
    'Get-ChildItem | ForEach-Object { Remove-Item $_ }': 'default_write',
  };
  for (const [command, category] of Object.entries(cases)) {
    const result = bash(command);
    assert.equal(result.category, category, command);
    assert.equal(result.verdict, 'deny', `${command} is refused in a read-only task`);
  }
});

test("calls to NerveCenter's own API count as access changes", () => {
  assert.equal(bash('curl -s http://127.0.0.1:8787/api/settings/policy').category, 'privileged_access');
  assert.equal(bash('curl -s -X PUT localhost:8787/api/settings/policy -d "{}"').category, 'privileged_access');
  // A fake platform on another local port is not the app.
  assert.equal(bash('curl -s http://127.0.0.1:8711/api/2.2/jobs/list').category, 'read');
});

test('the ways the agent reads stay reads', () => {
  const reads = [
    'ls -la && git log -5 --oneline',
    'databricks jobs list --output json',
    'databricks api get /api/2.1/jobs/list',
    'TZ=Asia/Kolkata date "+%H:%M"',
    'q(){ curl -s -X POST "$DATABRICKS_HOST/api/2.0/sql/statements" -H "Authorization: Bearer $DATABRICKS_TOKEN" -d "{\\"statement\\":\\"$1\\"}"; }\nq "SELECT count(*) FROM gold.sales"',
    '$r = Invoke-RestMethod -Uri "$env:DATABRICKS_HOST/api/2.2/jobs/list"; $r.jobs | Select-Object name | ConvertTo-Json',
    'python - <<\'PY\'\nimport json\nprint(json.dumps({"a": 1}))\nPY',
    '"--- mcp ---"; if (Test-Path "x.json") { Get-Content "x.json" -Raw } else { "none" }',
    'echo "now=$(date -u +%Y-%m-%dT%H:%M:%SZ)"',
    'gh pr view 12 --json title,state',
  ];
  for (const command of reads) assert.equal(bash(command).category, 'read', command);
});

test('SQL handed to a helper function is judged by what it does', () => {
  const helper = 'q(){ curl -s -X POST "$H/api/2.0/sql/statements" -d "{\\"statement\\":\\"$1\\"}"; }\n';
  assert.equal(bash(`${helper}q "DELETE FROM gold.sales WHERE 1=1"`).category, 'production_changes');
  assert.equal(bash(`${helper}q "SELECT 1"`).category, 'read');
});

test('writing a heredoc script into the task folder is a task file, a heredoc that writes elsewhere is not', () => {
  assert.equal(bash(`python - <<'PY'\nopen("${taskDir.replaceAll('\\', '/')}/out.csv", "w").write("a")\nPY`).category, 'task_files');
  assert.equal(bash(`python - <<'PY'\nopen("C:/elsewhere/out.csv", "w").write("a")\nPY`).category, 'default_write');
});
