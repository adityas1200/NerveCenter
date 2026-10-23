import path from 'node:path';
import fs from 'node:fs/promises';
import { readJson, writeJson } from '../lib/fs.mjs';
import { now } from '../lib/util.mjs';
import { findSecret } from './knowledge-drafts.mjs';

// Eval runs per journey (SPEC-knowledge-06) and the weekly pass digests (SPEC-knowledge-07). Each run and digest is
// written to its task's own folder; `knowledge/.journeys.json` is NerveCenter's bounded index of them, so the
// Knowledge page reads one small file. The score is always computed here, never taken from the model.

const FILE = '.journeys.json';
const JOURNEY = /^[a-z0-9][a-z0-9-]{0,59}$/;
const RESULTS = new Set(['pass', 'partial', 'fail']);
const MAX_CASES = 60;
const MAX_RUNS = 26;
const MAX_JOURNEYS = 40;
const MAX_DIGESTS = 12;
const TREND = 12;
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);

/** A case path as `<base>/evals/...md` or `evals/...md`; anything else is not an eval case (FR-3). */
export function casePath(value) {
  const raw = String(value || '').trim().replaceAll('\\', '/').replace(/^\.?\/+/, '').replace(/^knowledge\//, '');
  const parts = raw.split('/');
  if (!raw || parts.some(part => !part || part === '..' || part.startsWith('.')) || !/\.md$/i.test(raw) || !(parts[0] === 'evals' || parts[1] === 'evals')) throw new Error(`${value} is not an eval case: cases are pages in a base's evals/ folder`);
  return raw;
}

/** pass = 1, partial = 0.5, fail = 0, as a whole percent of the cases. */
export function scoreOf(cases) {
  if (!cases.length) return 0;
  const points = cases.reduce((sum, item) => sum + (item.result === 'pass' ? 1 : item.result === 'partial' ? 0.5 : 0), 0);
  return Math.round((points / cases.length) * 100);
}

export class KnowledgeJourneys {
  /** `drafts` is the project's KnowledgeDrafts, for the kept eval cases in its bases. */
  constructor({ knowledgeDir, drafts }) { Object.assign(this, { knowledgeDir, drafts }); }

  get #file() { return path.join(this.knowledgeDir, FILE); }
  async #read() {
    const data = await readJson(this.#file).catch(() => null);
    return { journeys: data && typeof data.journeys === 'object' && !Array.isArray(data.journeys) ? data.journeys : {}, digests: Array.isArray(data?.digests) ? data.digests : [] };
  }
  async #write(data) { await fs.mkdir(this.knowledgeDir, { recursive: true }); await writeJson(this.#file, data); }

  /** Record one eval run (FR-3, FR-4): validated, scored here, written to the task folder and the history. */
  async recordRun({ journey, cases } = {}, { taskId = null, taskDir = null } = {}) {
    const name = String(journey || '').trim().toLowerCase();
    if (!JOURNEY.test(name)) throw new Error('journey must be a short kebab-case name such as late-pipeline');
    if (!Array.isArray(cases) || !cases.length) throw new Error('Give the result of at least one case');
    if (cases.length > MAX_CASES) throw new Error(`A run takes at most ${MAX_CASES} cases`);
    const rows = cases.map(item => {
      const result = String(item?.result || '');
      if (!RESULTS.has(result)) throw new Error('Each case result must be pass, partial or fail');
      const note = clip(item.note, 300);
      if (findSecret(note)) throw new Error('A case note looks like it contains a credential; remove it');
      return { path: casePath(item.path), result, ...(note ? { note } : {}), ...(list(item.missing, 5).length ? { missing: list(item.missing, 5).map(value => clip(value, 300)) } : {}) };
    });
    const run = { at: now(), taskId, journey: name, score: scoreOf(rows), total: rows.length, passed: rows.filter(item => item.result === 'pass').length, partial: rows.filter(item => item.result === 'partial').length, failed: rows.filter(item => item.result === 'fail').length, cases: rows };
    if (taskDir) { await fs.mkdir(taskDir, { recursive: true }); await writeJson(path.join(taskDir, `eval-run-${name}.json`), run); }
    const data = await this.#read();
    const entry = data.journeys[name] || { runs: [] };
    entry.runs = [...(Array.isArray(entry.runs) ? entry.runs : []), run].slice(-MAX_RUNS);
    data.journeys[name] = entry;
    // Keep the 40 most recently run journeys.
    const names = Object.keys(data.journeys).sort((a, b) => String(data.journeys[b].runs?.at(-1)?.at || '').localeCompare(String(data.journeys[a].runs?.at(-1)?.at || '')));
    for (const extra of names.slice(MAX_JOURNEYS)) delete data.journeys[extra];
    await this.#write(data);
    const previous = entry.runs.length > 1 ? entry.runs.at(-2).score : null;
    return { journey: name, score: run.score, previous, total: run.total, passed: run.passed, partial: run.partial, failed: run.failed, link: '/knowledge' };
  }

  /** Kept eval cases per journey across the project's bases (FR-1, FR-2). */
  async #cases() {
    const counts = new Map();
    if (!this.drafts) return counts;
    const catalog = await this.drafts.catalog({ type: 'Eval Case' }).catch(() => ({ bases: [] }));
    for (const base of catalog.bases || []) for (const page of base.pages || []) {
      if (page.draft || !/(^|\/)evals\//.test(page.path)) continue;
      const journey = String(page.fields?.journey || '').trim().toLowerCase();
      if (JOURNEY.test(journey)) counts.set(journey, (counts.get(journey) || 0) + 1);
    }
    return counts;
  }

  /** Every journey with its latest score, trend and failing cases, weakest first (FR-5). */
  async journeys() {
    const [data, cases] = await Promise.all([this.#read(), this.#cases()]);
    const names = new Set([...Object.keys(data.journeys), ...cases.keys()]);
    const rows = [...names].map(name => {
      const runs = (Array.isArray(data.journeys[name]?.runs) ? data.journeys[name].runs : []).filter(run => run && Number.isFinite(run.score));
      const latest = runs.at(-1) || null;
      return {
        journey: name, cases: cases.get(name) || 0,
        latest: latest ? { score: latest.score, passed: latest.passed, partial: latest.partial, failed: latest.failed, total: latest.total, at: latest.at, taskId: latest.taskId || null } : null,
        previous: runs.length > 1 ? runs.at(-2).score : null,
        trend: runs.slice(-TREND).map(run => run.score),
        failing: latest ? (latest.cases || []).filter(item => item.result !== 'pass').slice(0, 10) : [],
      };
    });
    rows.sort((a, b) => (a.latest ? 0 : 1) - (b.latest ? 0 : 1) || (a.latest?.score ?? 0) - (b.latest?.score ?? 0) || a.journey.localeCompare(b.journey));
    return { journeys: rows };
  }

  /** Record the weekly pass digest (SPEC-knowledge-07 FR-3, FR-4). */
  async recordDigest(input = {}, { taskId = null, taskDir = null } = {}) {
    const n = value => Math.max(0, Math.min(100_000, Math.round(Number(value) || 0)));
    const drafts = input.drafts || {};
    const digest = {
      at: now(), taskId,
      drafts: { waiting: n(drafts.waiting), fromCorrections: n(drafts.fromCorrections), fromLessons: n(drafts.fromLessons), merged: n(drafts.merged) },
      stale: list(input.stale, 20).map(item => ({ path: clip(item?.path, 300), staleAfter: clip(item?.staleAfter, 20) || null })).filter(item => item.path),
      drift: list(input.drift, 20).map(item => ({ path: clip(item?.path, 300), field: clip(item?.field, 60), page: clip(item?.page, 200), live: clip(item?.live, 200) })).filter(item => item.path),
      changedDocs: list(input.changedDocs, 20).map(item => ({ path: clip(item?.path, 300), source: clip(item?.source, 300) })).filter(item => item.path),
      gaps: list(input.gaps, 10).map(item => ({ text: clip(item?.text, 300), ...(item?.journey ? { journey: clip(item.journey, 60) } : {}), tasks: list(item?.tasks, 10).map(id => clip(id, 40)) })).filter(item => item.text),
      evals: list(input.evals, 40).map(item => ({ journey: clip(item?.journey, 60), score: Math.max(0, Math.min(100, Math.round(Number(item?.score) || 0))), ...(Number.isFinite(Number(item?.previous)) && item?.previous !== null && item?.previous !== undefined ? { previous: Math.max(0, Math.min(100, Math.round(Number(item.previous)))) } : {}) })).filter(item => item.journey),
      weakest: clip(input.weakest, 60) || null,
      summary: clip(input.summary, 400),
    };
    if (!digest.summary) throw new Error('Give a one-paragraph summary of the week');
    if (findSecret(JSON.stringify(digest))) throw new Error('The digest looks like it contains a credential; remove it');
    if (taskDir) { await fs.mkdir(taskDir, { recursive: true }); await writeJson(path.join(taskDir, 'knowledge-digest.json'), digest); }
    const data = await this.#read();
    data.digests = [...data.digests, digest].slice(-MAX_DIGESTS);
    await this.#write(data);
    return { recorded: true, at: digest.at, link: '/knowledge' };
  }

  async latestDigest() { return (await this.#read()).digests.at(-1) || null; }
}
