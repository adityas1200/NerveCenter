import { z } from 'zod';

// Sonic's component catalog (SPEC-tasks-10, ADR 0009). Every component is defined here once: its tool,
// its shape and what it is for. The nervecenter server offers the tools, show_view validates its blocks,
// and the agent prompt lists the components, all from this list, so a new component is one entry here
// plus its renderer in the frontend (until then the frontend draws it as a plain card of its fields).
// None of these tools change anything: they are category `read` and echo what was drawn.

const str = (max, min = 1) => z.string().min(min).max(max);
const tone = z.enum(['neutral', 'good', 'bad', 'warning']).optional();
const ask = z.string().min(1).max(400).optional().describe('Optional: a follow-up the reader can send by clicking this item, written as the reader would say it');
const note = z.string().max(240).optional().describe('One line under the component: source, time window, or what to notice');
const cell = z.union([z.string().max(400), z.number(), z.null()]);

/** Inside the task folder: tasks/<this-id>/x or x, no other task's folder, no `..`, no absolute path. */
export function taskRelativePath(task, filePath) {
  const cleaned = String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
  const folder = /^tasks\/([^/]+)\//.exec(cleaned);
  if (folder && folder[1] !== String(task?.id)) throw new Error('The file must be inside this task\'s folder');
  const relative = folder ? cleaned.slice(folder[0].length) : cleaned;
  if (relative.includes('..') || relative.startsWith('/') || /^[a-z]:/i.test(relative)) throw new Error('The file must be inside the task folder');
  return relative;
}

const PULL_REQUEST_URL = /^https:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/pull|bitbucket\.org\/[\w.-]+\/[\w.-]+\/pull-requests)\/\d+\/?$/;

/**
 * kind: the component's name in the UI and inside show_view. tool: the MCP tool name. use: the line in the
 * prompt. view: whether show_view may hold it. alwaysLoad: kept in context (others load through tool search).
 * result(args, ctx): what the tool returns; throw to refuse the call with a message the agent can fix.
 */
export const COMPONENTS = [
  /* ------------------------------------------------------------ steering */
  {
    kind: 'plan', tool: 'propose_plan', alwaysLoad: true, view: false,
    use: 'your plan before work that changes anything: 3 to 7 plain steps; then update_plan as each finishes',
    description: 'Show the person your plan before you start work that changes anything (ticket and routine tasks; skip it for a quick question). 3 to 7 short steps in the order you will do them, each a plain sentence a business reader understands. NerveCenter draws it as a checklist that ticks as you call update_plan. Call it once per task; call it again only when the plan genuinely changes.',
    shape: {
      title: z.string().min(3).max(120).optional(),
      steps: z.array(z.object({ id: z.string().min(1).max(20).describe('Short stable id such as s1, s2'), text: z.string().min(3).max(200), kind: z.enum(['read', 'change', 'check']).optional().describe('read = look things up, change = writes to a system, check = verification') })).min(1).max(7),
    },
    result: ({ title, steps }) => ({ shown: true, planId: `plan-${Date.now().toString(36)}`, title: title || null, steps: steps.map(step => ({ id: step.id, text: step.text, kind: step.kind || 'read', state: 'pending' })), next: 'Call update_plan as you complete each step.' }),
  },
  {
    kind: 'plan_update', tool: 'update_plan', alwaysLoad: true, view: false,
    description: 'Mark a step of your plan done, skipped or blocked, with an optional note (one short sentence: what you found or why it was skipped). Call it as soon as the step finishes so the checklist stays live.',
    shape: { stepId: z.string().min(1).max(20), state: z.enum(['active', 'done', 'skipped', 'blocked']), note: z.string().max(240).optional() },
    result: ({ stepId, state, note: text }) => ({ shown: true, stepId, state, note: text || null }),
  },
  {
    kind: 'finding', tool: 'record_finding', alwaysLoad: true, view: false,
    use: 'each hypothesis, piece of evidence, ruled-out cause, root cause, fix and verification of an investigation; NerveCenter draws them as one investigation card',
    description: 'Record one finding of an investigation as you go, so NerveCenter can draw the investigation as hypotheses with evidence, what was ruled out, the root cause, the fix and its verification. Use it during RCA and failure investigations; each call is one finding. Attach evidence references so the person can open them.',
    shape: {
      kind: z.enum(['hypothesis', 'evidence', 'ruled_out', 'root_cause', 'fix', 'verification', 'inconclusive']),
      text: z.string().min(3).max(600).describe('One or two plain sentences'),
      id: z.string().min(1).max(20).optional().describe('Give hypotheses an id (h1, h2) so evidence and the root cause can point at them'),
      hypothesisId: z.string().max(20).optional().describe('For evidence, ruled_out and root_cause: which hypothesis this belongs to'),
      confidence: z.enum(['high', 'medium', 'low']).optional(),
      evidence: z.array(z.object({ label: z.string().min(1).max(120), kind: z.enum(['run', 'ticket', 'query', 'file', 'knowledge', 'table', 'url', 'log']).optional(), ref: z.string().max(400).optional().describe('Run id, ticket id, file path under the task folder, knowledge path, table name or URL') })).max(8).optional(),
    },
    result: finding => ({ shown: true, findingId: finding.id || `f-${Date.now().toString(36)}`, kind: finding.kind }),
  },
  {
    kind: 'outcome', tool: 'set_outcome', alwaysLoad: true, view: false,
    use: 'the line under the task title: call it whenever the task\'s state changes (recovered, blocked, needs the person, answered) with a headline and up to 5 short items such as "INC0031201 · Resolved"',
    description: 'Set the outcome line NerveCenter shows under the task title: the state, one headline sentence, and up to five short items (a record and its state, an open check, a count). Call it when the task\'s state changes; the latest call wins.',
    shape: {
      state: z.enum(['resolved', 'recovered', 'done', 'answered', 'in_progress', 'blocked', 'needs_you', 'failed']),
      headline: str(160).describe('One sentence a business reader understands'),
      items: z.array(z.object({ label: str(40), value: str(60), tone })).max(5).optional(),
    },
    result: ({ state, items = [] }) => ({ shown: true, state, items: items.length }),
  },
  {
    kind: 'explanation', tool: 'explain_action', alwaysLoad: true, view: false,
    use: 'right before any write that may need approval (a production run, a ticket status, an email, a push): what it does in plain words, the checks you made, impact, rollback; the approval card shows it with the exact command',
    description: 'Explain, in plain words, the change you are about to make, right before you make it. NerveCenter shows this on the approval card next to the exact command, so the person can decide without reading the command. Give what it does, the safety checks you made, the impact, the rollback and what happens if it fails. Call it once per change, immediately before the tool call that makes it.',
    shape: {
      title: str(120).describe('The action as a short imperative: "Rerun job 731 in production"'),
      what: str(400).describe('What will happen, one or two sentences'),
      checks: z.array(str(160)).max(6).optional().describe('Checks you made that make it safe, each a short sentence'),
      impact: z.string().max(240).optional(), rollback: z.string().max(240).optional(), ifFails: z.string().max(240).optional(),
    },
    result: ({ title }) => ({ shown: true, title, next: 'Make the change now; the person sees this explanation on the approval.' }),
  },
  {
    kind: 'actions', tool: 'show_actions', alwaysLoad: true, view: false,
    use: 'at the end of a turn that leaves work for the person: up to 6 next actions as buttons (ask = a message the person sends you by clicking, open = an app page, task file or https link) and up to 3 follow-up questions',
    description: 'End a turn with what the person can do next, as buttons. kind "ask" sends `prompt` to you as the person\'s message when clicked (write it as they would say it: "Rerun job 731"); mark needsApproval when doing it will ask for approval. kind "open" opens `href`: an app route starting with /, a file in the task folder, or an https link. Add up to 3 follow-up questions the person may want to ask; they show as chips above the message box.',
    shape: {
      title: z.string().max(80).optional(),
      items: z.array(z.object({ label: str(60), kind: z.enum(['ask', 'open']), prompt: z.string().max(600).optional(), href: z.string().max(400).optional(), detail: z.string().max(80).optional(), needsApproval: z.boolean().optional() })).max(6).default([]),
      questions: z.array(str(160)).max(3).optional(),
    },
    result: ({ items = [], questions = [] }) => {
      if (!items.length && !questions.length) throw new Error('Give at least one action or question');
      for (const item of items) {
        if (item.kind === 'ask' && !String(item.prompt || '').trim()) throw new Error(`The action "${item.label}" is kind ask and needs a prompt`);
        if (item.kind === 'open' && !/^(?!\/\/)(?:\/|https:\/\/|[\w.-]+(\/[\w.-]+)*\.\w+$)/.test(String(item.href || ''))) throw new Error(`The action "${item.label}" is kind open and needs an href: an app route starting with /, an https link or a task file`);
      }
      return { shown: true, actions: items.length, questions: questions.length };
    },
  },
  {
    kind: 'form', tool: 'request_input', alwaysLoad: true, view: false,
    use: 'when you need values from the person before you can continue (a date range, recipients, a choice of tables): a form of up to 8 typed fields; the task waits and the answers come back to you',
    description: 'Ask the person for values you need, as a form: 1 to 8 fields, each with a label and a type (text, textarea, number, date, email, select, multiselect, boolean). select and multiselect need 2 to 8 options. The task waits until the person answers; you get { answers } keyed by field label. Use AskUserQuestion instead for one quick choice between options.',
    shape: {
      title: str(160).describe('What you need, as a short sentence'),
      reason: z.string().max(300).optional().describe('Why you need it, one sentence'),
      fields: z.array(z.object({
        label: str(80), type: z.enum(['text', 'textarea', 'number', 'date', 'email', 'select', 'multiselect', 'boolean']),
        options: z.array(str(80)).max(8).optional(), required: z.boolean().optional(), placeholder: z.string().max(120).optional(),
      })).min(1).max(8),
      answers: z.record(z.string(), z.string()).optional().describe('Filled in by NerveCenter with the person\'s answers; leave it out'),
    },
    validate: ({ fields }) => {
      const labels = new Set();
      for (const field of fields) {
        const key = field.label.trim().toLowerCase();
        if (labels.has(key)) throw new Error(`Two fields are called "${field.label}"; give each a different label`);
        labels.add(key);
        if (['select', 'multiselect'].includes(field.type) && (field.options || []).length < 2) throw new Error(`The field "${field.label}" is a ${field.type} and needs 2 to 8 options`);
      }
    },
    result: ({ answers }) => ({ answers: answers || {}, answered: Boolean(answers && Object.keys(answers).length) }),
  },

  /* ---------------------------------------------------------------- data */
  {
    kind: 'table', tool: 'show_table', alwaysLoad: true, view: true,
    use: 'rows with a status word or ids (up to 8 columns, 50 rows); a Status column is coloured',
    description: 'Show a small table as a card in the task (up to 8 columns and 50 rows). Use it instead of a markdown table whenever rows have a status word, an id the person may open, or more than five rows. Values are strings or numbers; put a status word in a column named Status and NerveCenter colours it.',
    shape: { title: str(120), columns: z.array(str(60)).min(1).max(8), rows: z.array(z.array(cell)).min(1).max(50), note },
    result: ({ title, rows }) => ({ shown: true, title, rows: rows.length }),
  },
  {
    kind: 'metrics', tool: 'show_metrics', alwaysLoad: true, view: true,
    use: 'one to four headline numbers as tiles with a tone',
    description: 'Show one to four headline numbers as tiles: rows loaded, failures this week, minutes late, records fixed. Each has a label, a value, an optional unit or suffix, an optional delta ("+3 vs last week"), an optional trend (recent values, oldest first, drawn as a sparkline) and a tone.',
    shape: { items: z.array(z.object({ label: str(60), value: z.union([z.string().max(60), z.number()]), suffix: z.string().max(30).optional(), delta: z.string().max(80).optional(), trend: z.array(z.number()).min(2).max(30).optional().describe('Optional: the recent values oldest first, drawn as a small trend line in the tile'), tone })).min(1).max(4) },
    result: ({ items }) => ({ shown: true, items: items.length }),
  },
  {
    kind: 'chart', tool: 'show_chart', alwaysLoad: true, view: true,
    use: 'numbers over time or by category: column, bar, line or area, up to 6 series; donut for the parts of one whole (failures by cause); never for one number (use show_metrics)',
    description: 'Show numbers as a chart: column (counts per day or week), bar (ranked categories), line or area (change over time), donut (the parts of one whole, first series only, up to 8 parts). labels are the x-axis buckets or categories; each series has a name and one value per label. Up to 60 labels and 6 series. Use layout "grouped" for measures that do not add up. Name a series after a status (Failed, Passed, Late) and NerveCenter colours it.',
    shape: {
      title: str(120), type: z.enum(['column', 'bar', 'line', 'area', 'donut']).default('column'),
      labels: z.array(str(40)).min(1).max(60),
      series: z.array(z.object({ name: str(60), values: z.array(z.number()).max(60) })).min(1).max(6),
      layout: z.enum(['stacked', 'grouped']).optional(), unit: z.string().max(20).optional(), note,
    },
    validate: ({ labels, series }) => { const bad = series.find(item => item.values.length !== labels.length); if (bad) throw new Error(`Series "${bad.name}" has ${bad.values.length} values for ${labels.length} labels; give one value per label`); },
    result: ({ title, series, labels }) => ({ shown: true, title, series: series.length, points: labels.length }),
  },
  {
    kind: 'facts', tool: 'show_facts', alwaysLoad: false, view: true,
    use: 'label and value pairs about one thing (a job, a table, a person, a config)',
    description: 'Show facts about one thing as label and value pairs: a job\'s schedule, owner and last run; a table\'s size and freshness; a config\'s values. Up to 16 pairs; a tone colours a value.',
    shape: { title: z.string().max(120).optional(), items: z.array(z.object({ label: str(60), value: z.union([z.string().max(200), z.number()]), tone })).min(1).max(16), note },
    result: ({ items }) => ({ shown: true, items: items.length }),
  },

  /* ------------------------------------------------------ status and time */
  {
    kind: 'heatmap', tool: 'show_heatmap', alwaysLoad: true, view: true,
    use: 'a number across two dimensions as shaded cells: failures by hour and weekday, null rate by column and day, DQ score by table and day, runs by job and week',
    description: 'Show a number across two dimensions as a grid of shaded cells, darker for more: failures by hour of day and weekday, null rate by column and day, DQ score by table and day, minutes late by job and week. One row per thing, one value per column (null for no data). scale says which end is bad: "high_is_bad" shades red, "high_is_good" green, "neutral" in the brand colour. Up to 14 rows and 31 columns; give a unit.',
    shape: {
      title: str(120), columns: z.array(z.string().max(24)).min(1).max(31),
      rows: z.array(z.object({ label: str(80), values: z.array(z.union([z.number(), z.null()])).min(1).max(31) })).min(1).max(14),
      scale: z.enum(['high_is_bad', 'high_is_good', 'neutral']).default('neutral'), unit: z.string().max(20).optional(), note,
    },
    validate: ({ columns, rows }) => { const bad = rows.find(row => row.values.length !== columns.length); if (bad) throw new Error(`Row "${bad.label}" has ${bad.values.length} values for ${columns.length} columns; give one value (or null) per column`); },
    result: ({ title, rows, columns }) => ({ shown: true, title, rows: rows.length, columns: columns.length }),
  },
  {
    kind: 'gauges', tool: 'show_gauges', alwaysLoad: true, view: true,
    use: 'one to four measures against a target or limit as rings: SLA met %, freshness hours against the limit, DQ pass rate, budget used',
    description: 'Show one to four measures against a target or limit as rings: SLA met this month (value 92, max 100, target 95), freshness (value 26, max 48, target 24, higher_is_better false), DQ pass rate, cost against budget. The ring fills value/max; the target is a tick on the ring; the colour comes from the value against the target and direction, so do not pass a tone unless you must.',
    shape: {
      title: z.string().max(120).optional(),
      items: z.array(z.object({ label: str(60), value: z.number(), max: z.number().positive(), target: z.number().optional(), unit: z.string().max(12).optional(), higherIsBetter: z.boolean().default(true), sub: z.string().max(80).optional(), tone })).min(1).max(4),
      note,
    },
    result: ({ items }) => ({ shown: true, items: items.length }),
  },
  {
    kind: 'funnel', tool: 'show_funnel', alwaysLoad: false, view: true,
    use: 'counts through stages in order with what was lost between them: rows landed, valid, loaded, published; records matched; tickets triaged to resolved',
    description: 'Show counts falling through stages in order, with the drop between each pair: rows landed → passed checks → loaded → published, records received → matched → deduplicated, tickets opened → triaged → resolved. 2 to 8 stages, largest first; a stage may carry a short note on why rows were dropped.',
    shape: { title: str(120), stages: z.array(z.object({ label: str(60), value: z.number().min(0), note: z.string().max(120).optional() })).min(2).max(8), unit: z.string().max(20).optional(), note },
    result: ({ title, stages }) => ({ shown: true, title, stages: stages.length }),
  },
  {
    kind: 'gantt', tool: 'show_gantt', alwaysLoad: true, view: true,
    use: 'runs or jobs as bars on one time axis: which runs overlapped, how long each took, what ran past its SLA or window',
    description: 'Show runs, jobs or stages as bars on one time axis, one lane per job (or per run): which runs overlapped, how long each took, where a job ran past its window, a backfill\'s batches. Each bar has a start and an end (ISO timestamps; leave end out for a run still going), a state (ok, failed, warning, running, skipped) and an optional label. markers are vertical lines such as an SLA deadline or a deploy. Up to 12 lanes and 60 bars.',
    shape: {
      title: str(120),
      lanes: z.array(z.object({ label: str(80), sub: z.string().max(80).optional(), bars: z.array(z.object({ start: str(40), end: z.string().max(40).optional(), state: z.enum(['ok', 'failed', 'warning', 'running', 'skipped']).default('ok'), label: z.string().max(160).optional(), ask })).min(1).max(30) })).min(1).max(12),
      markers: z.array(z.object({ at: str(40), label: str(60), tone })).max(4).optional(),
      note,
    },
    validate: ({ lanes, markers = [] }) => {
      const total = lanes.reduce((sum, lane) => sum + lane.bars.length, 0);
      if (total > 60) throw new Error(`${total} bars; show at most 60, or one lane per job with fewer runs`);
      for (const lane of lanes) for (const bar of lane.bars) {
        if (Number.isNaN(Date.parse(bar.start))) throw new Error(`Bar in "${lane.label}" has start "${bar.start}"; use an ISO timestamp`);
        if (bar.end && Number.isNaN(Date.parse(bar.end))) throw new Error(`Bar in "${lane.label}" has end "${bar.end}"; use an ISO timestamp`);
        if (bar.end && Date.parse(bar.end) < Date.parse(bar.start)) throw new Error(`Bar in "${lane.label}" ends before it starts`);
      }
      const marker = markers.find(item => Number.isNaN(Date.parse(item.at)));
      if (marker) throw new Error(`Marker "${marker.label}" has at "${marker.at}"; use an ISO timestamp`);
    },
    result: ({ title, lanes }) => ({ shown: true, title, lanes: lanes.length, bars: lanes.reduce((sum, lane) => sum + lane.bars.length, 0) }),
  },
  {
    kind: 'status_grid', tool: 'show_status_grid', alwaysLoad: true, view: true,
    use: 'states over time or across things: runs per day per job, checks per run, SLA per brand; a row per thing, a cell per column',
    description: 'Show states as a grid: one row per thing (a job, a check, a brand) and one cell per column (a day, a run, an environment). Each cell has a state (ok, failed, warning, running, skipped, none) and an optional label shown on hover ("24 Sep 04:00 · Failed after 19s"). Use it for run history, a check across runs, a control job beside the failing one. Up to 12 rows and 14 columns.',
    shape: {
      title: str(120), columns: z.array(z.string().max(24)).min(1).max(14),
      rows: z.array(z.object({ label: str(80), sub: z.string().max(80).optional(), cells: z.array(z.object({ state: z.enum(['ok', 'failed', 'warning', 'running', 'skipped', 'none']), label: z.string().max(200).optional(), ask })).min(1).max(14) })).min(1).max(12),
      note,
    },
    validate: ({ columns, rows }) => { const bad = rows.find(row => row.cells.length > columns.length); if (bad) throw new Error(`Row "${bad.label}" has ${bad.cells.length} cells for ${columns.length} columns`); },
    result: ({ title, rows }) => ({ shown: true, title, rows: rows.length }),
  },
  {
    kind: 'timeline', tool: 'show_timeline', alwaysLoad: true, view: true,
    use: 'what happened when (2 to 20 events)',
    description: 'Show events in time order as a card (2 to 20 events). Use it for what happened when: run starts and failures, ticket updates, fixes and verifications. Times are ISO timestamps or "HH:MM UTC" strings.',
    shape: { title: str(120), events: z.array(z.object({ at: str(40), text: str(240), tone })).min(2).max(20) },
    result: ({ title, events }) => ({ shown: true, title, events: events.length }),
  },
  {
    kind: 'progress', tool: 'show_progress', alwaysLoad: false, view: true,
    use: 'the steps of a run or process with state and duration (a job\'s tasks, a deployment)',
    description: 'Show the steps of a run or process with their state and how long each took, as bars in time order: a job\'s tasks, a backfill\'s batches, a deployment\'s stages. Give seconds for finished steps so the bars are to scale.',
    shape: {
      title: str(120), state: z.enum(['running', 'done', 'failed']).default('done'),
      steps: z.array(z.object({ label: str(80), state: z.enum(['done', 'running', 'failed', 'pending', 'skipped']), seconds: z.number().min(0).optional(), note: z.string().max(160).optional() })).min(1).max(12),
      note,
    },
    result: ({ title, steps }) => ({ shown: true, title, steps: steps.length }),
  },
  {
    kind: 'flow', tool: 'show_flow', alwaysLoad: true, view: true,
    use: 'stages in a line with a state each: where data or a process broke and what is stale downstream (file → ingest → curate → gold → dashboard)',
    description: 'Show stages in a line, each with a state (done, failed, stale, running, pending, skipped, warning) and a short line under it: where a load broke and what is stale after it, the stages of a release, the steps a request goes through. 2 to 10 stages. Use show_lineage instead for a graph with branches.',
    shape: { title: str(120), steps: z.array(z.object({ label: str(60), sub: z.string().max(80).optional(), state: z.enum(['done', 'failed', 'stale', 'running', 'pending', 'skipped', 'warning']) })).min(2).max(10), note },
    result: ({ title, steps }) => ({ shown: true, title, steps: steps.length }),
  },

  /* ---------------------------------------------- investigation and change */
  {
    kind: 'comparison', tool: 'show_comparison', alwaysLoad: true, view: true,
    use: 'before/after or expected/actual values (up to 12 rows)',
    description: 'Show a before/after or expected/actual comparison as a card: two columns and up to 12 rows. Use it for a run against its usual, a config diff a business reader should see.',
    shape: { title: str(120), beforeLabel: str(40).default('Before'), afterLabel: str(40).default('After'), rows: z.array(z.object({ label: str(80), before: cell, after: cell, changed: z.boolean().optional() })).min(1).max(12) },
    result: ({ title, rows }) => ({ shown: true, title, rows: rows.length }),
  },
  {
    kind: 'set_diff', tool: 'show_set_diff', alwaysLoad: false, view: true,
    use: 'two lists side by side with what is added or missing: contract columns against file columns, granted against requested access',
    description: 'Show two lists aligned, with items only on one side marked: a data contract\'s columns against a file\'s header, the access a person has against what they asked for, the tables in dev against prod. Up to 60 items a side, in their real order.',
    shape: { title: str(120), leftLabel: str(40), rightLabel: str(40), left: z.array(str(80)).max(60), right: z.array(str(80)).max(60), note },
    result: ({ title, left, right }) => { const a = new Set(left); const b = new Set(right); return { shown: true, title, added: right.filter(item => !a.has(item)).length, missing: left.filter(item => !b.has(item)).length }; },
  },
  {
    kind: 'checklist', tool: 'show_checklist', alwaysLoad: true, view: true,
    use: 'checks with evidence and a result (pass, fail, open, skipped, info): verification after a fix, preflight before a change, acceptance criteria',
    description: 'Show checks as a list, each with the evidence and a result: pass, fail, open (not yet known), skipped or info. Use it to verify a fix, for a preflight before a change, for acceptance criteria or a compliance check. An open item can carry an ask prompt so the person can ask you to settle it.',
    shape: { title: str(120), items: z.array(z.object({ label: str(160), evidence: z.string().max(400).optional(), result: z.enum(['pass', 'fail', 'open', 'skipped', 'info']), ask })).min(1).max(20), note },
    result: ({ title, items }) => ({ shown: true, title, items: items.length }),
  },
  {
    kind: 'records', tool: 'show_records', alwaysLoad: true, view: true,
    use: 'records you changed in other systems (ticket states, Jira issues, rows): from state, to state, read back or not',
    description: 'Show the records you changed in other systems: a ServiceNow incident resolved, a Jira issue moved, a row updated. Each has its system, id, the state before and after, a short note, and whether you read it back to confirm. Call it after the writes, not before.',
    shape: { title: str(120), items: z.array(z.object({ system: str(40), id: str(80), title: z.string().max(160).optional(), from: z.string().max(40).optional(), to: str(40), note: z.string().max(240).optional(), verified: z.boolean().optional(), url: z.string().max(400).optional() })).min(1).max(12) },
    result: ({ title, items }) => ({ shown: true, title, items: items.length }),
  },
  {
    kind: 'lineage', tool: 'show_lineage', alwaysLoad: true, view: true,
    use: 'data lineage as a graph with the broken asset and what it affects',
    description: 'Show the data lineage you found as an interactive graph in the task: where the data comes from (upstream) and what reads it (downstream). Mark the node at the centre of the problem as failed or stale and the ones it affects as affected, so a business reader sees the blast radius at a glance. Find the lineage yourself (Unity Catalog lineage system tables, Snowflake ACCESS_HISTORY or OBJECT_DEPENDENCIES, job definitions, code, knowledge); this tool only draws it. Use it in every RCA and impact question.',
    shape: {
      title: str(120),
      focus: z.string().max(200).optional().describe('Id of the node the question is about'),
      nodes: z.array(z.object({ id: str(200), label: z.string().max(120).optional().describe('Short name; defaults to the id'), kind: z.enum(['source', 'table', 'view', 'job', 'pipeline', 'model', 'file', 'dashboard', 'board', 'report', 'api', 'other']).optional(), system: z.string().max(40).optional().describe('databricks, snowflake, s3…'), status: z.enum(['ok', 'failed', 'stale', 'affected', 'unknown']).optional(), owner: z.string().max(80).optional(), note: z.string().max(200).optional().describe('One line: row count, last update, what is wrong') })).min(1).max(40),
      edges: z.array(z.object({ from: z.string().max(200), to: z.string().max(200), label: z.string().max(60).optional() })).max(80),
      note: z.string().max(240).optional().describe('One line under the graph: where the lineage came from'),
    },
    validate: ({ nodes, edges }) => {
      const ids = new Set(nodes.map(node => node.id));
      const missing = edges.flatMap(edge => [edge.from, edge.to]).filter(id => !ids.has(id));
      if (missing.length) throw new Error(`Edges point at nodes that are not in the list: ${[...new Set(missing)].slice(0, 5).join(', ')}`);
    },
    result: ({ title, nodes, edges }) => ({ shown: true, title, nodes: nodes.length, edges: edges.length }),
  },
  {
    kind: 'change', tool: 'show_change', alwaysLoad: true, view: true,
    use: 'a code, SQL, job or config change as diffs with how you tested it; before asking to apply, and again once applied',
    description: 'Show a change you made or propose, as a reviewable card: the files with their diffs, and how you tested it (for example on a zero-copy clone, in dev, or with unit tests) and the result. Use it whenever you change code, SQL, a job definition or configuration, before asking for approval to apply it, and again once it is applied.',
    shape: {
      title: str(120),
      summary: z.string().max(400).optional().describe('One or two sentences: what changes and why'),
      state: z.enum(['proposed', 'applied', 'reverted']).default('proposed'),
      files: z.array(z.object({ path: str(300), diff: z.string().max(12000).describe('Unified diff (lines starting with +, - or a space)'), language: z.string().max(20).optional() })).min(1).max(10),
      testing: z.object({ method: z.string().max(200).describe('How you tested: "zero-copy clone of gold.sales", "pytest", "dry run in dev"'), result: z.enum(['passed', 'failed', 'inconclusive', 'not_tested']), detail: z.string().max(400).optional() }).optional(),
      link: z.string().max(400).optional().describe('Pull request or commit URL'),
    },
    result: ({ title, files, testing }) => ({ shown: true, title, files: files.length, testing: testing?.result || null }),
  },
  {
    kind: 'pull_request', tool: 'show_pull_request', alwaysLoad: false, view: true,
    use: 'a pull request you opened or updated, after GitHub or Bitbucket returned it',
    description: 'Show a pull request you opened (or updated) as a card in the task, after GitHub or Bitbucket returned it. Give its URL, number, title, head branch and base branch exactly as the service reports them, whether it is a draft, and one line on what it changes.',
    shape: {
      url: z.string().regex(PULL_REQUEST_URL, 'Give the pull request URL, e.g. https://github.com/owner/repo/pull/12 or https://bitbucket.org/workspace/repo/pull-requests/12'),
      number: z.number().int().positive(), title: str(200),
      branch: str(200).describe('Head branch'), base: str(200).describe('Base branch'),
      state: z.enum(['open', 'draft', 'merged', 'closed']).default('open'),
      summary: z.string().max(240).optional().describe('One line: what the change does'),
      ticketId: z.string().max(40).optional().describe('The NerveCenter ticket the change fixes, if any'),
      additions: z.number().int().min(0).optional(), deletions: z.number().int().min(0).optional(), files: z.number().int().min(0).optional(),
    },
    validate: ({ url, number }) => { const found = /\/pull(?:-requests)?\/(\d+)/.exec(url); if (Number(found?.[1]) !== number) throw new Error(`The URL is pull request ${found?.[1]}, not ${number}`); },
    result: ({ url, number }) => ({ shown: true, url, number }),
  },

  /* -------------------------------------------- communication and documents */
  {
    kind: 'email', tool: 'show_email', alwaysLoad: false, view: false,
    use: 'an email draft the person can edit, before you send anything; they click Send and you send exactly their version',
    description: 'Show an email draft the person can edit in place: recipients, subject and body. The body is plain text as the recipient will read it: no markdown (no **bold**, no headings); blank lines between paragraphs and "• " for a list item. Show it before you send anything; when the person clicks Send, you get their edited version as a message and send exactly that. Use status "sent" to show an email you already sent.',
    shape: { to: z.array(str(200)).min(1).max(20), cc: z.array(str(200)).max(20).optional(), subject: str(200), body: str(6000), status: z.enum(['draft', 'sent']).default('draft'), note },
    result: ({ subject, status = 'draft' }) => ({ shown: true, subject, status }),
  },
  {
    kind: 'document', tool: 'show_document', alwaysLoad: false, view: true,
    use: 'a document, deck or sheet you produced in the task folder, with its outline',
    description: 'Show a document you produced (a Word document, a deck, a sheet, a PDF or a report) as a card with its outline, so the person sees what is in it and opens it from the task. The path is a file in the task folder.',
    shape: { title: str(120), format: z.enum(['document', 'deck', 'sheet', 'pdf', 'report', 'other']).default('document'), path: z.string().max(300).optional(), summary: z.string().max(400).optional(), outline: z.array(z.object({ heading: str(120), status: z.enum(['done', 'draft', 'todo']).optional() })).max(20).optional() },
    validate: ({ path: filePath }, { task }) => { if (filePath) taskRelativePath(task, filePath); },
    result: ({ title, path: filePath }, { task }) => ({ shown: true, title, path: filePath ? taskRelativePath(task, filePath) : null }),
  },
  {
    kind: 'notes', tool: 'show_notes', alwaysLoad: true, view: true,
    use: 'up to 6 short titled notes with a tone: what is worth knowing, risks, caveats, assumptions',
    description: 'Show short notes the person should not miss, each with a bold title and one or two sentences: what is worth knowing, risks, caveats, assumptions, things you could not confirm. Up to 6; give a tone (warning, bad) to the ones that need attention.',
    shape: { title: z.string().max(80).optional(), items: z.array(z.object({ title: str(120), text: str(400), tone })).min(1).max(6) },
    result: ({ items }) => ({ shown: true, items: items.length }),
  },
  {
    kind: 'artifact', tool: 'show_artifact', alwaysLoad: true, view: false,
    use: 'a self-contained HTML report, SVG, image, markdown or PDF you wrote in the task folder, framed inline',
    description: 'Show a file you wrote in the task folder inline in the task as an artifact the person reads there: a self-contained HTML report or dashboard (inline CSS, no scripts), an SVG, an image or a markdown document. Call it once the file is complete. Use it for investigations, data pulls, weekly reports and comparisons instead of a long chat reply; keep the reply to the headline and next actions.',
    shape: {
      path: str(300).describe('Path under the task folder, e.g. tasks/T-1031/report.html or report.html'),
      title: str(120), kind: z.enum(['report', 'dashboard', 'document', 'image']).optional(),
      summary: z.string().max(240).optional().describe('One line under the title: what the reader will find'),
    },
    result: ({ path: filePath, title, kind, summary }, { task }) => {
      let relative;
      try { relative = taskRelativePath(task, filePath); } catch { throw new Error('The artifact must be a file inside this task\'s folder'); }
      if (!/\.(html?|svg|png|jpe?g|gif|webp|md|markdown|pdf)$/i.test(relative)) throw new Error('Artifacts are HTML, SVG, image, Markdown or PDF files');
      return { shown: true, path: relative, title, kind: kind || (/\.html?$/i.test(relative) ? 'report' : /\.(svg|png|jpe?g|gif|webp)$/i.test(relative) ? 'image' : 'document'), summary: summary || null };
    },
  },

  /* ---------------------------------------------- data from NerveCenter itself */
  {
    kind: 'ticket', tool: 'show_ticket', alwaysLoad: false, view: false, bound: true,
    use: 'a NerveCenter ticket as a card, read from the app (give its id; NerveCenter fills in the fields)',
    description: 'Show a NerveCenter ticket as a card the person can open. Give its id or number; NerveCenter reads the ticket itself, so the card shows its real title, status, priority and assignee.',
    shape: { ticketId: str(80), note },
    result: async ({ ticketId, note: text }, { readTicket }) => ({ shown: true, ticket: await readTicket(ticketId), note: text || null }),
  },
  {
    kind: 'pipeline_runs', tool: 'show_pipeline_runs', alwaysLoad: false, view: false, bound: true,
    use: 'a pipeline\'s recent runs as a status strip and duration chart, read from the app (give its id)',
    description: 'Show a pipeline\'s recent runs as a card: a strip of run states and a chart of durations, read by NerveCenter from its run history, so the numbers are the platform\'s. Give the pipeline id from list_pipelines.',
    shape: { pipelineId: str(200), limit: z.number().int().min(2).max(20).optional(), title: z.string().max(120).optional(), note },
    result: async ({ pipelineId, limit = 10, title, note: text }, { readRuns }) => ({ shown: true, pipelineId, title: title || null, runs: await readRuns(pipelineId, limit), note: text || null }),
  },
];

const VIEW_KINDS = COMPONENTS.filter(component => component.view);

/** One block of a view: a component's shape with its kind and a width. */
const viewBlock = z.discriminatedUnion('kind', VIEW_KINDS.map(component => z.object({ kind: z.literal(component.kind), width: z.enum(['full', 'half']).optional(), ...component.shape })));

COMPONENTS.push({
  kind: 'view', tool: 'show_view', alwaysLoad: false, view: false,
  use: `several components as one titled view, for a stakeholder summary or a dashboard answer: 1 to 12 blocks, each one of ${VIEW_KINDS.map(component => component.kind).join(', ')}, full or half width`,
  description: `Show several components together as one titled view: a stakeholder summary, a status report, a dashboard-style answer. Each block is one of: ${VIEW_KINDS.map(component => component.kind).join(', ')}, with the same fields as its show_ tool plus "kind" and an optional width (full, or half to sit two side by side). 1 to 12 blocks in reading order. Put the most important block first.`,
  shape: { title: str(120), summary: z.string().max(300).optional(), blocks: z.array(viewBlock).min(1).max(12) },
  validate: ({ blocks }, ctx) => { for (const block of blocks) { const component = VIEW_KINDS.find(item => item.kind === block.kind); try { component?.validate?.(block, ctx); } catch (error) { throw new Error(`Block ${blocks.indexOf(block) + 1} (${block.kind}): ${error.message}`); } } },
  result: ({ title, blocks }) => ({ shown: true, title, blocks: blocks.map(block => block.kind) }),
});

/** Tool name to component, for the categories check and the tests. */
export const COMPONENT_TOOLS = Object.freeze(Object.fromEntries(COMPONENTS.map(component => [component.tool, component])));

/** The catalog as nervecenter tools. `tool` is the server's wrapper (category check, permission, error handling). */
export function catalogTools({ tool, task, readTicket, readRuns }) {
  const ctx = { task, readTicket, readRuns };
  return COMPONENTS
    .filter(component => !component.bound || (component.tool === 'show_ticket' ? readTicket : readRuns))
    .map(component => tool(component.tool, component.description, component.shape, async args => {
      component.validate?.(args, ctx);
      return component.result(args, ctx);
    }, { alwaysLoad: component.alwaysLoad }));
}

/** The prompt's catalog: one line per component, so Sonic knows what it can draw without loading every schema. */
export function catalogPromptLines() {
  return [
    'Answer with components, not prose, whenever the content is data. NerveCenter draws each of these calls where you make it; markdown is for explanation only. The components:',
    ...COMPONENTS.filter(component => component.use).map(component => `- ${component.tool}: ${component.use}.`),
  ];
}
