import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { now, httpError } from '../lib/util.mjs';
import { cleanFields, fieldLines, indexPages, linksOf, mergeFields, pageKey, resolveTarget, scalarsOf } from './knowledge-links.mjs';

// Lessons the agent saves after verified work. Every save is a draft in the base's own Git
// working tree: a new page is an untracked file with `status: draft`, a section added to an
// existing page sits between `<!-- draft -->` markers. Nothing is committed until a person
// keeps it on the Knowledge page; discarding restores the file. A local base that is not yet a
// repository becomes one (with a baseline commit) the first time a draft lands in it, so every
// draft can be diffed and undone.
//
// The code checks shape and safety only (inside a base, markdown, additive, no secrets). Whether
// a lesson is worth saving, whether it is already known and where it belongs is the agent's
// judgement, guided by the knowledge skill's lesson capture; nothing here maps a kind of ticket
// to a page.

const run = promisify(execFile);
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_CONTENT = 12_000;
const MAX_DIFF = 20_000;
const MAX_CATALOG_FILES = 400;
/** Where a draft came from (SPEC-knowledge-05 FR-2). */
const ORIGINS = new Set(['lesson', 'correction', 'interview', 'document', 'pass', 'eval']);
const DEFAULT_BASE = { name: 'team-knowledge', title: 'Team knowledge', description: 'Lessons, runbooks and known issues the team has learned from its work.' };
const COMMITTER = ['-c', 'user.name=NerveCenter', '-c', 'user.email=nervecenter@localhost'];
const today = () => new Date().toISOString().slice(0, 10);

/** Credentials and keys that must never land in knowledge. Deliberately narrow: shapes, not words. */
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  /\bdapi[0-9a-f]{32}\b/i,
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[^\s"'<>]{8,}/i,
  /Authorization:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/i,
];
export function findSecret(text) { const value = String(text || ''); return SECRET_PATTERNS.some(pattern => pattern.test(value)); }

/**
 * Frontmatter as YAML (SPEC-knowledge-04 FR-3): block lists and quoted values read correctly. Values come back as
 * strings or lists of strings (objects stay objects). Frontmatter that is not valid YAML falls back to the line
 * reader, so a hand-edited page with a typo is still listed rather than failing the whole catalog.
 */
export function readFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(text || ''));
  if (!match) return { data: {}, body: String(text || ''), raw: '' };
  let parsed = null;
  try { parsed = YAML.parse(match[1]); } catch { parsed = null; }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const data = {};
    for (const [key, value] of Object.entries(parsed)) data[key] = Array.isArray(value) ? value.filter(item => item !== null && item !== undefined).map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item))) : value !== null && typeof value === 'object' ? value : value === null || value === undefined ? '' : String(value);
    return { data, body: String(text).slice(match[0].length), raw: match[0] };
  }
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line); if (!pair) continue;
    let value = pair[2].trim();
    if (/^\[.*\]$/.test(value)) value = value.slice(1, -1).split(',').map(item => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else value = value.replace(/^["']|["']$/g, '');
    data[pair[1]] = value;
  }
  return { data, body: String(text).slice(match[0].length), raw: match[0] };
}

const headingsOf = body => [...String(body).matchAll(/^(#{1,4})\s+(.+?)\s*#*\s*$/gm)].map(match => ({ level: match[1].length, text: match[2].trim() }));
const isDraftText = text => /^status:\s*draft\s*$/m.test(readFrontmatter(text).raw) || /<!--\s*draft\b/.test(text);
const yamlValue = value => (/^[\w .,/()&+-]*$/.test(value) && !/^\s|\s$|^-/.test(value) ? value : JSON.stringify(value));

/** A path inside a base: relative, markdown, no hidden or parent segments, never an index. */
export function cleanPagePath(value) {
  const raw = String(value || '').trim().replaceAll('\\', '/').replace(/^\.?\/+/, '');
  if (!raw) throw new Error('path is required: the page inside the base, for example known-issues/pipelines.md');
  const parts = raw.split('/');
  if (parts.length > 6 || parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new Error(`${value} is not a page inside the knowledge base`);
  if (!/\.md$/i.test(raw)) throw new Error('Knowledge pages are markdown files ending in .md');
  if (/^index\.md$/i.test(parts[parts.length - 1])) throw new Error('Add lessons to a concept page, not to an index; the index is updated when a person keeps the draft');
  return parts.join('/');
}

/** Insert `block` at the end of the section headed `section` (any level), before the next heading of the same or a higher level. */
export function insertUnderSection(text, section, block) {
  const lines = String(text).split(/\r?\n/);
  const wanted = String(section).trim().replace(/^#+\s*/, '').toLowerCase();
  const start = lines.findIndex(line => { const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line); return match && match[2].trim().toLowerCase() === wanted; });
  if (start === -1) return null;
  const level = /^(#{1,6})/.exec(lines[start])[1].length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) { const match = /^(#{1,6})\s/.exec(lines[index]); if (match && match[1].length <= level) { end = index; break; } }
  // A draft block is one unit: if the next heading sits inside one, the section ends before that block starts.
  let open = -1;
  for (let index = start + 1; index < end; index += 1) { if (/^\s*<!--\s*draft\b/.test(lines[index])) open = index; else if (/^\s*<!--\s*\/draft\s*-->/.test(lines[index])) open = -1; }
  if (open !== -1) end = open;
  while (end > start + 1 && !lines[end - 1].trim()) end -= 1;
  lines.splice(end, 0, '', ...block.split('\n'), '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Keeping a draft: drop the draft markers, and mark a new page stable and reviewed by this person. */
export function acceptDraftText(text, reviewer) {
  let out = String(text).replace(/^[ \t]*<!--\s*draft\b[^>]*-->[ \t]*\r?\n?/gm, '').replace(/^[ \t]*<!--\s*\/draft\s*-->[ \t]*\r?\n?/gm, '');
  const front = readFrontmatter(out);
  if (front.raw && /^status:\s*draft\s*$/m.test(front.raw)) {
    const lines = front.raw.trimEnd().split(/\r?\n/);
    const closing = lines.pop();
    const updated = lines.map(line => (/^status:\s*draft\s*$/.test(line) ? 'status: stable' : line)).filter(line => !/^verified:/.test(line));
    updated.push(`verified: {by: "human:${reviewer}", at: "${now()}"}`);
    out = `${[...updated, closing].join('\n')}\n${front.body}`;
  }
  return out;
}

export class KnowledgeDrafts {
  // `isShared(name)` says a base is a grant link into the shared library: read-only here (SPEC-projects-01 FR-34/FR-35),
  // so lessons land in the project's own bases. `library` is the library's own drafts, the only way into a shared base
  // and only for a task that was started to build that base.
  constructor({ knowledgeDir, runner = run, git = 'git', onBasesChanged = async () => {}, timeoutMs = 60_000, isShared = async () => false, library = null }) { Object.assign(this, { knowledgeDir, runner, git, onBasesChanged, timeoutMs, isShared, library }); }

  get #metaFile() { return path.join(this.knowledgeDir, '.drafts.json'); }
  async #meta() { try { return JSON.parse(await fs.readFile(this.#metaFile, 'utf8')) || {}; } catch { return {}; } }
  async #saveMeta(meta) { await fs.mkdir(this.knowledgeDir, { recursive: true }); await fs.writeFile(this.#metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8'); }
  async #git(dir, args) { return this.runner(this.git, ['-C', dir, ...COMMITTER, ...args], { timeout: this.timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); }

  baseDir(name) { const key = String(name || '').trim().toLowerCase(); if (!SLUG.test(key)) throw new Error('base must be the short name of a knowledge base'); return path.join(this.knowledgeDir, key); }
  /** Every base the project can read: its own and the shared ones it was granted (links to a folder count). */
  async bases() {
    const entries = await fs.readdir(this.knowledgeDir, { withFileTypes: true }).catch(() => []);
    const names = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || !SLUG.test(entry.name)) continue;
      if (entry.isDirectory() || (entry.isSymbolicLink() && await fs.stat(path.join(this.knowledgeDir, entry.name)).then(stat => stat.isDirectory(), () => false))) names.push(entry.name);
    }
    return names.sort();
  }
  /** The bases a lesson may be saved into: the project's own, never a shared one. */
  async localBases() { const names = []; for (const name of await this.bases()) if (!(await this.isShared(name))) names.push(name); return names; }

  /** True only when the base folder is itself the top of a repository (never a parent repository around the workspace). */
  async #isOwnRepo(dir) {
    try { await fs.access(path.join(dir, '.git')); } catch { return false; }
    try {
      const { stdout } = await this.#git(dir, ['rev-parse', '--show-toplevel']);
      const real = async value => (await fs.realpath(path.resolve(value)).catch(() => path.resolve(value))).toLowerCase();
      return (await real(String(stdout).trim())) === (await real(dir));
    } catch { return false; }
  }
  async #ensureRepo(dir) {
    if (await this.#isOwnRepo(dir)) return;
    await this.runner(this.git, ['init', '-q', dir], { timeout: this.timeoutMs, windowsHide: true });
    await this.#git(dir, ['add', '-A']);
    await this.#git(dir, ['commit', '-q', '--allow-empty', '-m', 'Baseline before agent drafts']);
  }

  /**
   * The knowledge map the agent chooses a place from: every base with its index description, and
   * every page with its title, description, type, status, tags and section headings. No bodies.
   */
  async catalog({ base, type, field, value, linksTo, stale } = {}) {
    const names = base ? [String(base).toLowerCase()] : await this.bases();
    const filtered = Boolean(type || field || linksTo || stale);
    if (field && value === undefined) throw new Error('Give value with field, for example field "brands" and value "business/brand-x"');
    const out = []; const budget = { files: 0, truncated: false };
    for (const name of names) {
      const { pages, title, description } = await this.#pages(name, budget);
      // Typed links and backlinks (SPEC-knowledge-04 FR-4, FR-5): resolved within this base.
      const byKey = indexPages(pages.map(page => page.path));
      const backlinks = new Map();
      for (const page of pages) for (const values of Object.values(page.links)) for (const item of values) { const target = resolveTarget(item, byKey); if (target && target !== page.path) { const list = backlinks.get(target) || new Set(); list.add(page.path); backlinks.set(target, list); } }
      // Compare values the way links resolve: a page by its path without .md, anything else as written, case-insensitive.
      const norm = item => pageKey(resolveTarget(item, byKey) || item);
      const linkTarget = linksTo ? norm(linksTo) : null;
      const wantType = type ? String(type).toLowerCase() : null;
      const wantValue = value === undefined ? null : norm(value);
      const rows = pages.filter(page => {
        if (wantType && String(page.type || '').toLowerCase() !== wantType) return false;
        if (stale && !page.stale) return false;
        if (field) { const values = page.links[field] || (page.fields[field] !== undefined ? [page.fields[field]] : []); if (!values.some(item => norm(item) === wantValue)) return false; }
        if (linkTarget && !Object.values(page.links).flat().some(item => norm(item) === linkTarget)) return false;
        return true;
      }).map(({ links, fields, ...page }) => ({
        ...page,
        ...(Object.keys(links).length ? { links } : {}),
        ...(Object.keys(fields).length ? { fields } : {}),
        ...(backlinks.get(page.path)?.size ? { backlinks: [...backlinks.get(page.path)].sort().slice(0, 20) } : {}),
      }));
      out.push({ base: name, title, ...(description ? { description } : {}), ...(await this.isShared(name) ? { shared: true, readOnly: true } : {}), pages: rows });
    }
    return {
      bases: out,
      ...(filtered ? { filter: { ...(type ? { type } : {}), ...(field ? { field, value } : {}), ...(linksTo ? { linksTo } : {}), ...(stale ? { stale: true } : {}) } } : {}),
      ...(budget.truncated ? { truncated: `Only the first ${MAX_CATALOG_FILES} pages are listed; pass base to see one base in full.` } : {}),
      ...(out.length ? {} : { note: `There is no knowledge base yet. If a lesson is worth keeping, save it with base "${DEFAULT_BASE.name}" and it is created.` }),
    };
  }

  /** Every markdown page of one base with its frontmatter facts, within the shared page budget. */
  async #pages(name, budget = { files: 0, truncated: false }) {
    const dir = this.baseDir(name);
    const index = await fs.readFile(path.join(dir, 'index.md'), 'utf8').catch(() => '');
    const indexMeta = readFrontmatter(index).data;
    const pages = [];
    const today = new Date().toISOString().slice(0, 10);
    const walk = async (folder, relative, depth) => {
      if (depth > 6 || budget.truncated) return;
      const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.')) continue;
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { await walk(path.join(folder, entry.name), rel, depth + 1); continue; }
        if (!/\.(md|markdown)$/i.test(entry.name)) continue;
        if (budget.files >= MAX_CATALOG_FILES) { budget.truncated = true; return; }
        budget.files += 1;
        const text = await fs.readFile(path.join(folder, entry.name), 'utf8').catch(() => '');
        const { data, body } = readFrontmatter(text.slice(0, 200_000));
        const headings = headingsOf(body);
        const fields = scalarsOf(data);
        const staleAfter = /^\d{4}-\d{2}-\d{2}/.exec(fields.stale_after || '')?.[0] || null;
        pages.push({
          path: rel,
          title: String(data.title || headings.find(item => item.level === 1)?.text || entry.name.replace(/\.(md|markdown)$/i, '')),
          ...(data.description ? { description: String(data.description).slice(0, 300) } : {}),
          ...(data.type ? { type: String(data.type) } : {}),
          ...(data.status ? { status: String(data.status) } : {}),
          ...(data.owner ? { owner: Array.isArray(data.owner) ? data.owner.join(', ') : String(data.owner) } : {}),
          ...(Array.isArray(data.tags) && data.tags.length ? { tags: data.tags } : {}),
          sections: headings.filter(item => item.level >= 2 && item.level <= 3).slice(0, 25).map(item => `${'#'.repeat(item.level)} ${item.text}`),
          ...(isDraftText(text) ? { draft: true } : {}),
          ...(staleAfter ? { staleAfter, stale: staleAfter < today } : {}),
          links: linksOf(data), fields,
        });
      }
    };
    await walk(dir, '', 0);
    return { pages, title: String(indexMeta.title || name), description: indexMeta.description ? String(indexMeta.description) : null };
  }

  /**
   * The knowledge map of one base (SPEC-knowledge-04 FR-10): every page as a node with its shelf, state and typed
   * links, plus per-shelf and overall counts. Bounded by the same 400-page budget as the catalog.
   */
  async map(name) {
    const key = String(name || '').toLowerCase();
    const dir = this.baseDir(key);
    if (!(await fs.stat(dir).then(stat => stat.isDirectory(), () => false))) throw httpError(404, 'Knowledge base not found');
    const budget = { files: 0, truncated: false };
    const { pages, title } = await this.#pages(key, budget);
    const byKey = indexPages(pages.map(page => page.path));
    const shelfOf = page => (page.includes('/') ? page.split('/')[0] : page.replace(/\.(md|markdown)$/i, ''));
    const linked = new Set();
    let linkCount = 0;
    const nodes = pages.filter(page => !/(^|\/)index\.md$/i.test(page.path)).map(page => {
      const links = [];
      for (const [field, values] of Object.entries(page.links)) for (const target of values) {
        const resolved = resolveTarget(target, byKey);
        links.push({ field, target, page: resolved && resolved !== page.path ? resolved : null });
        if (resolved && resolved !== page.path) { linked.add(page.path); linked.add(resolved); linkCount += 1; }
      }
      return { path: page.path, title: page.title, type: page.type || null, shelf: shelfOf(page.path), status: page.draft ? 'draft' : 'kept', stale: Boolean(page.stale), staleAfter: page.staleAfter || null, owner: page.owner || null, description: page.description || null, fields: page.fields, links };
    });
    const shelves = new Map();
    for (const node of nodes) { const shelf = shelves.get(node.shelf) || { name: node.shelf, pages: 0, drafts: 0, stale: 0 }; shelf.pages += 1; if (node.status === 'draft') shelf.drafts += 1; if (node.stale) shelf.stale += 1; shelves.set(node.shelf, shelf); }
    return {
      base: key, title, pages: nodes,
      shelves: [...shelves.values()].sort((a, b) => a.name.localeCompare(b.name)),
      totals: { pages: nodes.length, kept: nodes.filter(node => node.status === 'kept').length, drafts: nodes.filter(node => node.status === 'draft').length, stale: nodes.filter(node => node.stale).length, links: linkCount, orphans: nodes.filter(node => !linked.has(node.path)).length },
      truncated: budget.truncated,
    };
  }

  /**
   * Save a lesson as a draft. decision "create" writes a new page; "append" adds a section to an
   * existing page (under `section` when given, else at the end); "skip" writes nothing and records why.
   */
  async write(input = {}, { taskId = null, actor = null, allowShared = false } = {}) {
    const decision = String(input.decision || '');
    // A shared base is changed in the library by the task that was started to build it; any other save goes to the project's own bases.
    const wanted = String(input.base || '').trim().toLowerCase();
    if (wanted && decision !== 'skip' && await this.isShared(wanted)) {
      if (!(allowShared && this.library)) throw new Error(`${wanted} is a shared knowledge base and is read-only here. Save the lesson in one of this project's own bases (${(await this.localBases()).join(', ') || 'none yet: leave base out and one is created'}), or skip it`);
      return this.library.write(input, { taskId, actor });
    }
    const checked = (Array.isArray(input.checked) ? input.checked : []).map(String).slice(0, 12);
    if (decision === 'skip') return { decision: 'skip', saved: false, checked, why: String(input.placementReason || '').slice(0, 600) || null, note: 'Nothing saved. Leave this out of your reply.' };
    if (!['create', 'append'].includes(decision)) throw new Error('decision must be create, append or skip');
    // Where the draft came from (SPEC-knowledge-05 FR-2): a teach moment names who taught it.
    const origin = String(input.origin || 'lesson');
    if (!ORIGINS.has(origin)) throw new Error(`origin must be one of ${[...ORIGINS].join(', ')}`);
    const taughtBy = String(input.taughtBy || '').trim().replace(/\s+/g, ' ').slice(0, 80) || null;
    if (taughtBy && !['correction', 'interview'].includes(origin)) throw new Error('taughtBy names the person who said it; use it only with origin correction or interview');
    const fields = cleanFields(input.fields);
    const content = String(input.content || '').trim();
    if (!content && !(decision === 'append' && fields)) throw new Error('content is required: the lesson in markdown (an append may give only fields)');
    if (content.length > MAX_CONTENT) throw new Error(`Keep the lesson under ${MAX_CONTENT} characters; save the smallest reusable part`);
    if (/<!--\s*\/?draft\b/.test(content)) throw new Error('Leave out the draft markers; they are added for you');
    if (findSecret(`${content}\n${input.title || ''}\n${input.description || ''}\n${fields ? JSON.stringify(fields) : ''}`)) throw new Error('The lesson looks like it contains a credential or key. Remove it and describe the fix without it');

    const existing = await this.localBases();
    let base = String(input.base || '').trim().toLowerCase();
    let createdBase = false;
    if (!base && existing.length === 0) base = DEFAULT_BASE.name;
    if (!existing.includes(base)) {
      if (existing.length) throw new Error(`No knowledge base named ${base || '(none given)'}; choose one of ${existing.join(', ')}`);
      createdBase = true;
    }
    const dir = this.baseDir(base);
    const page = cleanPagePath(input.path);
    const file = path.join(dir, ...page.split('/'));
    if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep)) throw new Error('The page must be inside the knowledge base');

    if (createdBase) {
      await fs.mkdir(dir, { recursive: true });
      const title = base === DEFAULT_BASE.name ? DEFAULT_BASE.title : base.replace(/-/g, ' ').replace(/^./, char => char.toUpperCase());
      const description = base === DEFAULT_BASE.name ? DEFAULT_BASE.description : 'Lessons the team has learned from its work.';
      await fs.writeFile(path.join(dir, 'index.md'), `---\ntype: Index\ntitle: ${title}\ndescription: ${description}\nstatus: stable\n---\n\n# ${title}\n\n${description}\n`, 'utf8');
    }
    await this.#ensureRepo(dir);
    if (createdBase) await this.onBasesChanged();

    const source = String(input.sourceTicket || taskId || '').trim().slice(0, 80);
    const markerValue = value => String(value).replace(/\s+/g, '-').replace(/[<>]|--/g, '');
    const marker = `<!-- draft${source ? ` source=${markerValue(source)}` : ''}${origin !== 'lesson' ? ` origin=${origin}` : ''}${taughtBy ? ` by=${markerValue(taughtBy)}` : ''} updated=${today()} -->`;
    let written; let title = String(input.title || '').trim().slice(0, 120);
    const current = await fs.readFile(file, 'utf8').catch(() => null);
    if (decision === 'create') {
      if (current !== null) throw new Error(`${page} already exists; use decision "append" to add a section to it`);
      if (!title) throw new Error('title is required for a new page');
      const tags = (Array.isArray(input.tags) ? input.tags : []).map(tag => String(tag).trim().toLowerCase()).filter(tag => /^[\w.-]{1,40}$/.test(tag)).slice(0, 8);
      const front = [
        '---',
        `type: ${yamlValue(String(input.type || 'Concept').trim().slice(0, 40) || 'Concept')}`,
        `title: ${yamlValue(title)}`,
        ...(input.description ? [`description: ${yamlValue(String(input.description).trim().slice(0, 300))}`] : []),
        ...(tags.length ? [`tags: [${tags.join(', ')}]`] : []),
        'status: draft',
        ...(input.owner && !fields?.owner ? [`owner: ${yamlValue(String(input.owner).trim().slice(0, 80))}`] : []),
        ...fieldLines(fields),
        ...(source ? [`source: ${yamlValue(source)}`] : []),
        ...(origin !== 'lesson' ? [`origin: ${origin}`] : []),
        `updated: ${today()}`,
        '---',
        '',
      ].join('\n');
      written = `${front}${/^#\s/m.test(content) ? '' : `# ${title}\n\n`}${content}\n`;
      await fs.mkdir(path.dirname(file), { recursive: true });
    } else {
      if (current === null) throw new Error(`${page} does not exist; use decision "create" for a new page`);
      // Fields merge into the frontmatter (SPEC-knowledge-04 FR-9); the git diff of the draft shows the change.
      const base0 = fields ? mergeFields(current, readFrontmatter(current).data, fields) : current;
      if (!content) written = base0;
      else {
        const block = `${marker}\n${content}\n<!-- /draft -->`;
        if (input.section) {
          written = insertUnderSection(base0, input.section, block);
          if (written === null) throw new Error(`No section "${input.section}" in ${page}. Its sections are: ${headingsOf(readFrontmatter(current).body).map(item => item.text).slice(0, 20).join('; ') || 'none'}`);
        } else written = `${base0.replace(/\s*$/, '')}\n\n${block}\n`;
      }
      if (written === current) throw new Error(`${page} already has these fields and nothing else was given; skip instead`);
      if (!title) title = headingsOf(content)[0]?.text || (fields ? `Fields on ${page}: ${Object.keys(fields).join(', ')}` : page);
    }
    await fs.writeFile(file, written, 'utf8');

    // Read back: the change is on disk and shows as a draft in the base's working tree.
    const check = await fs.readFile(file, 'utf8');
    if (!check.includes(content.split('\n')[0])) throw new Error('The draft did not save; nothing was changed');
    const meta = await this.#meta();
    const key = `${base}/${page}`;
    meta[key] = [...(meta[key] || []), { decision, title, section: input.section || null, sourceTicket: source || null, reason: String(input.placementReason || '').slice(0, 600) || null, origin, taughtBy, fields: fields ? Object.keys(fields) : [], checked, taskId, actor: actor ? { id: String(actor.id), name: actor.name || String(actor.id) } : null, at: now() }];
    await this.#saveMeta(meta);
    return { decision, saved: true, status: 'draft', base, path: page, title, origin, ...(taughtBy ? { taughtBy } : {}), ...(fields ? { fields } : {}), ...(createdBase ? { createdBase: true } : {}), link: `/knowledge/${encodeURIComponent(base)}?file=${encodeURIComponent(page)}`, note: 'Saved as a draft for a person to keep or discard. Leave it out of your reply, including any list of files or records changed: NerveCenter already shows it as a step in the task.' };
  }

  /** Uncommitted files in the base's own repository: the drafts waiting for review, each with its diff and why it was saved. */
  async list(base) {
    const dir = this.baseDir(base);
    if (!(await this.#isOwnRepo(dir))) return [];
    const { stdout } = await this.#git(dir, ['status', '--porcelain', '-z', '--untracked-files=all']);
    const meta = await this.#meta();
    const items = [];
    for (const record of String(stdout || '').split('\0').filter(Boolean)) {
      const code = record.slice(0, 2); const file = record.slice(3);
      if (!file || file.split('/').some(part => part.startsWith('.'))) continue;
      const change = code === '??' || code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : 'modified';
      let diff = '';
      if (change === 'added') { const text = await fs.readFile(path.join(dir, ...file.split('/')), 'utf8').catch(() => ''); diff = text.split(/\r?\n/).map(line => `+${line}`).join('\n'); }
      else diff = String((await this.#git(dir, ['diff', '--no-color', '-U3', 'HEAD', '--', file]).catch(() => ({ stdout: '' }))).stdout || '');
      const notes = meta[`${base}/${file}`] || [];
      const last = notes[notes.length - 1] || null;
      items.push({ base, path: file, change, title: last?.title || file, section: last?.section || null, sourceTicket: last?.sourceTicket || null, reason: last?.reason || null, origin: last?.origin || null, taughtBy: last?.taughtBy || null, taskId: last?.taskId || null, by: last ? 'agent' : 'unknown', at: last?.at || null, saves: notes.length, diff: diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n… (diff truncated)` : diff });
    }
    return items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  }

  async count(base) { try { return (await this.list(base)).length; } catch { return 0; } }

  async #pending(base, page) {
    const items = await this.list(base);
    const wanted = page ? cleanAnyPath(page) : null;
    const chosen = wanted ? items.filter(item => item.path === wanted) : items;
    if (wanted && !chosen.length) throw httpError(404, `${wanted} has no draft to review`);
    return chosen;
  }

  /** A person keeps a draft (or all of them): markers dropped, new pages marked stable and linked from the base index, then committed under their name. */
  async keep(base, page, user) {
    const dir = this.baseDir(base);
    const chosen = await this.#pending(base, page);
    if (!chosen.length) return { base, kept: [] };
    const reviewer = String(user?.id || 'reviewer');
    const toAdd = [];
    for (const item of chosen) {
      const file = path.join(dir, ...item.path.split('/'));
      if (item.change === 'deleted') { toAdd.push(item.path); continue; }
      const text = await fs.readFile(file, 'utf8');
      await fs.writeFile(file, acceptDraftText(text, reviewer), 'utf8');
      toAdd.push(item.path);
      if (item.change === 'added' && /\.md$/i.test(item.path) && !/(^|\/)index\.md$/i.test(item.path)) {
        const indexFile = path.join(dir, 'index.md');
        const index = await fs.readFile(indexFile, 'utf8').catch(() => null);
        if (index !== null && !index.includes(`](${item.path})`)) {
          const { data } = readFrontmatter(text);
          await fs.writeFile(indexFile, `${index.replace(/\s*$/, '')}\n- [${data.title || item.title}](${item.path})${data.description ? `: ${data.description}` : ''}\n`, 'utf8');
          if (!toAdd.includes('index.md')) toAdd.push('index.md');
        }
      }
    }
    await this.#git(dir, ['add', '-A', '--', ...toAdd]);
    const titles = chosen.map(item => item.title).slice(0, 3).join(', ');
    const author = `${String(user?.name || reviewer).replace(/[<>]/g, '')} <${reviewer.replace(/[<>\s]/g, '') || 'reviewer'}@nervecenter>`;
    await this.#git(dir, ['commit', '-q', '--author', author, '-m', `Keep knowledge: ${titles}${chosen.length > 3 ? ` and ${chosen.length - 3} more` : ''}`, '-m', `Reviewed in NerveCenter by ${user?.name || reviewer}. Sources: ${[...new Set(chosen.map(item => item.sourceTicket).filter(Boolean))].join(', ') || 'n/a'}`]);
    const meta = await this.#meta(); for (const item of chosen) delete meta[`${base}/${item.path}`]; await this.#saveMeta(meta);
    return { base, kept: chosen.map(item => item.path) };
  }

  /** A person discards a draft (or all of them): a new page is removed, an edited page is restored to its last kept version. */
  async discard(base, page) {
    const dir = this.baseDir(base);
    const chosen = await this.#pending(base, page);
    for (const item of chosen) {
      if (item.change === 'added') {
        const file = path.join(dir, ...item.path.split('/'));
        await fs.rm(file, { force: true });
        // Tidy folders the draft created and left empty.
        let folder = path.dirname(file);
        while (path.resolve(folder) !== path.resolve(dir)) { const left = await fs.readdir(folder).catch(() => ['x']); if (left.length) break; await fs.rmdir(folder).catch(() => {}); folder = path.dirname(folder); }
      } else await this.#git(dir, ['checkout', 'HEAD', '--', item.path]);
    }
    const meta = await this.#meta(); for (const item of chosen) delete meta[`${base}/${item.path}`]; await this.#saveMeta(meta);
    return { base, discarded: chosen.map(item => item.path) };
  }
}

/** A draft path as reported by git: relative, forward slashes, no parent segments. */
function cleanAnyPath(value) {
  const raw = String(value || '').trim().replaceAll('\\', '/').replace(/^\.?\/+/, '');
  if (!raw || raw.split('/').some(part => !part || part === '..')) throw new Error('path must be a file inside the knowledge base');
  return raw;
}
