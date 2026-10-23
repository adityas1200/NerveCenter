import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFECTS, evaluateRules, normalizeRules, resourceMatches, resourceString, validatePolicySection } from '../src/tasks/policy-rules.mjs';
import { POLICY_CATEGORIES, classifyTool, resourcesFor } from '../src/tasks/permission-policy.mjs';

// Scoped policy rules: "allow job runs in dev, never in production" instead of one answer
// for every Databricks job everywhere. Modelled on an IAM policy document.

const platforms = [{
  name: 'databricks', type: 'databricks',
  environments: { prod: { workspace: 'https://adb-prod.azuredatabricks.net' }, dev: { workspace: 'https://adb-dev.azuredatabricks.net' } },
}];
const gate = (tool, input, policy, extra = {}) => classifyTool(tool, input, { permission: 'policy', policy, platforms, ...extra });
const runJob = host => ({ command: `curl -X POST ${host}/api/2.2/jobs/run-now -d {"job_id":42}` });

test('a resource pattern is padded with wildcards, so a short one covers everything inside it', () => {
  const job = resourceString({ system: 'databricks', environment: 'prod', type: 'job', name: 'customer_orders_daily' });
  assert.equal(job, 'databricks:prod:job:customer_orders_daily');
  for (const pattern of ['*', 'databricks', 'databricks:prod', 'databricks:*:job:*', 'databricks:prod:job:customer_orders_daily', '*:*:job:customer_*']) {
    assert.equal(resourceMatches(pattern, job), true, `${pattern} should cover the job`);
  }
  for (const pattern of ['snowflake:*', 'databricks:dev', 'databricks:prod:table:*', '*:*:job:other_*']) {
    assert.equal(resourceMatches(pattern, job), false, `${pattern} should not cover the job`);
  }
});

test('an unknown segment satisfies a deny or ask rule but never an allow: uncertainty does not widen permission', () => {
  const unattributed = resourceString({ system: 'databricks', type: 'job', name: '42' }); // no environment
  assert.equal(unattributed, 'databricks:-:job:42');
  assert.equal(resourceMatches('databricks:prod:*', unattributed, { lenient: true }), true, 'a deny still bites');
  assert.equal(resourceMatches('databricks:prod:*', unattributed, { lenient: false }), false, 'an allow does not fire on a guess');
  assert.equal(resourceMatches('databricks:*', unattributed, { lenient: false }), true, 'a segment that is known still has to match');
});

test('the most restrictive matching rule wins, and an explicit deny cannot be widened', () => {
  const rules = normalizeRules([
    { effect: 'allow', action: '*', resource: '*' },
    { effect: 'ask', action: 'production_changes', resource: 'databricks:*' },
    { effect: 'deny', action: 'production_changes', resource: 'databricks:prod:*' },
  ], { categories: POLICY_CATEGORIES }).rules;
  const pick = resource => evaluateRules(rules, { action: 'production_changes', resources: [resource] })?.effect;
  assert.equal(pick('databricks:prod:job:42'), 'deny', 'deny beats the ask and the allow that also match');
  assert.equal(pick('databricks:dev:job:42'), 'ask', 'ask beats the blanket allow');
  assert.equal(pick('snowflake:prod:table:x'), 'allow', 'only the blanket rule matches');
  assert.equal(evaluateRules(rules, { action: 'email_send', resources: ['email:-:recipient:a@b.com'] })?.effect, 'allow', 'action * covers every category');
  assert.equal(evaluateRules([], { action: 'production_changes', resources: ['databricks:prod:job:42'] }), null, 'no rules means the baseline decides');
});

test('a call that writes two tables is judged by the more restricted of them', () => {
  const rules = normalizeRules([{ effect: 'deny', action: 'production_changes', resource: '*:*:table:gold.*' }], { categories: POLICY_CATEGORIES }).rules;
  assert.equal(evaluateRules(rules, { action: 'production_changes', resources: ['databricks:dev:table:bronze.raw', 'databricks:dev:table:gold.orders'] })?.effect, 'deny');
  assert.equal(evaluateRules(rules, { action: 'production_changes', resources: ['databricks:dev:table:bronze.raw'] }), null);
});

test('a rule narrows one environment while widening another', () => {
  const policy = { production_changes: 'ask', rules: [
    { effect: 'deny', action: 'production_changes', resource: 'databricks:prod:*', description: 'never run production jobs' },
    { effect: 'allow', action: 'production_changes', resource: 'databricks:dev:*' },
  ] };
  assert.equal(gate('Bash', runJob('https://adb-prod.azuredatabricks.net'), policy).verdict, 'deny');
  assert.equal(gate('Bash', runJob('https://adb-dev.azuredatabricks.net'), policy).verdict, 'allow');
  // A workspace the platforms section does not name cannot be attributed, so the deny still applies.
  assert.equal(gate('Bash', runJob('https://elsewhere.example.com'), policy).verdict, 'deny');
  assert.match(gate('Bash', runJob('https://adb-prod.azuredatabricks.net'), policy).reason, /never run production jobs/);
});

test('with no rules at all the category baseline decides, exactly as before', () => {
  assert.equal(gate('Bash', runJob('https://adb-prod.azuredatabricks.net'), { production_changes: 'ask' }).verdict, 'ask');
  assert.equal(gate('Bash', runJob('https://adb-prod.azuredatabricks.net'), { production_changes: 'allow' }).verdict, 'allow');
  assert.equal(gate('Bash', runJob('https://adb-prod.azuredatabricks.net'), { production_changes: 'deny' }).verdict, 'deny');
});

test('reads are still never gated, whatever the rules say', () => {
  const policy = { rules: [{ effect: 'deny', action: '*', resource: '*' }] };
  assert.equal(gate('Read', { file_path: '/tmp/x' }, policy).verdict, 'allow');
  assert.equal(gate('mcp__databricks__list_jobs', {}, policy).verdict, 'allow');
});

test('a rule can name a recipient, a table or a ticket, not just a system', () => {
  const noCompetitors = { email_send: 'allow', rules: [{ effect: 'deny', action: 'email_send', resource: 'email:*:recipient:*@competitor.com' }] };
  assert.equal(gate('mcp__email__send_message', { to: 'someone@competitor.com' }, noCompetitors).verdict, 'deny');
  assert.equal(gate('mcp__email__send_message', { to: 'colleague@company.com' }, noCompetitors).verdict, 'allow');

  const protectGold = { production_changes: 'allow', rules: [{ effect: 'ask', action: 'production_changes', resource: '*:*:table:gold.*' }] };
  assert.equal(gate('mcp__databricks__execute_sql', { statement: 'INSERT INTO gold.orders SELECT 1' }, protectGold).verdict, 'ask');
  assert.equal(gate('mcp__databricks__execute_sql', { statement: 'INSERT INTO bronze.raw SELECT 1' }, protectGold).verdict, 'allow');

  const oneProject = { ticket_writes: 'allow', rules: [{ effect: 'deny', action: 'ticket_writes', resource: 'jira:*:ticket:SEC-*' }] };
  assert.equal(gate('mcp__jira__jira_transition_issue', { issue_key: 'SEC-12' }, oneProject).verdict, 'deny');
  assert.equal(gate('mcp__jira__jira_transition_issue', { issue_key: 'DATAOPS-12' }, oneProject).verdict, 'allow');
});

test('what a call touches is read from its arguments, its SQL and its URL', () => {
  assert.deepEqual(resourcesFor('mcp__databricks__run_job', { job_id: 42 }, { platforms }), ['databricks:-:job:42']);
  assert.deepEqual(resourcesFor('Bash', runJob('https://adb-dev.azuredatabricks.net'), { platforms }), ['databricks:dev:job:42']);
  assert.deepEqual(resourcesFor('mcp__databricks__execute_sql', { statement: 'MERGE INTO gold.orders USING s ON 1=1' }, { platforms }), ['databricks:-:table:gold.orders']);
  assert.deepEqual(resourcesFor('mcp__email__send_message', { to: ['a@x.com', 'b@y.com'] }, {}), ['email:-:recipient:a@x.com', 'email:-:recipient:b@y.com']);
  // Nothing identifiable: one bare resource, so only a system or environment rule can match it.
  assert.deepEqual(resourcesFor('mcp__snowflake__do_something', {}, { platforms }), ['snowflake:-:-:-']);
});

test('a platform with a single environment answers for every call to it', () => {
  const single = [{ name: 'databricks', type: 'databricks', environments: { prod: { workspace: 'https://adb-prod.azuredatabricks.net' } } }];
  assert.deepEqual(resourcesFor('mcp__databricks__run_job', { job_id: 7 }, { platforms: single }), ['databricks:prod:job:7']);
  assert.deepEqual(resourcesFor('mcp__databricks__run_job', { job_id: 7 }, { platforms: [] }), ['databricks:-:job:7']);
});

test('a malformed rule is reported rather than guessed at, and never silently applied', () => {
  const { rules, problems } = normalizeRules([
    { effect: 'deny', action: 'production_changes', resource: 'databricks:prod:*' },
    { effect: 'maybe', action: 'production_changes', resource: '*' },
    { effect: 'allow', action: 'not_a_category', resource: '*' },
    { effect: 'allow', resource: '$(rm -rf /)' },
    'nonsense',
  ], { categories: POLICY_CATEGORIES });
  assert.equal(rules.length, 1, 'only the sound rule survives');
  assert.deepEqual(problems, [
    'policy.rules[1].effect must be deny, ask, allow',
    'policy.rules[2].action must be * or one of: email_send, privileged_access, production_changes, ticket_writes, workspace_changes, knowledge_drafts, default_write',
    'policy.rules[3].resource has characters that are not allowed: $(rm -rf /)',
    'policy.rules[4] must be a mapping',
  ]);
  assert.deepEqual(normalizeRules(undefined).problems, []);
  assert.deepEqual(normalizeRules('nope').problems, ['policy.rules must be a list']);
  assert.deepEqual(EFFECTS, ['deny', 'ask', 'allow']);
});

test('the settings section refuses to save rules it cannot read', () => {
  assert.deepEqual(validatePolicySection({ rules: [{ effect: 'deny', action: '*', resource: '*' }] }, { categories: POLICY_CATEGORIES }), []);
  assert.deepEqual(validatePolicySection({ production_changes: 'ask' }), []);
  assert.deepEqual(validatePolicySection(undefined), []);
  assert.deepEqual(validatePolicySection([]), ['policy must be a mapping']);
  assert.equal(validatePolicySection({ rules: [{ effect: 'nope' }] }).length, 1);
});
