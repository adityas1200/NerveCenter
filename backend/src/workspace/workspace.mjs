import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { WORKSPACE_DIR, PLUGIN_DIR } from '../config.mjs';
import { ensureDir, exists, writeJson, safeJoin } from '../lib/fs.mjs';
import { POLICY_DEFAULTS as APP_POLICY_DEFAULTS } from '../tasks/permission-policy.mjs';
import { validateAgentSection } from '../tasks/agent-model.mjs';
import { POLICY_CATEGORIES } from '../tasks/permission-policy.mjs';
import { validatePolicySection } from '../tasks/policy-rules.mjs';
import { slug, clone, httpError } from '../lib/util.mjs';
import { PerProject, projectIdOf } from '../projects/project-bound.mjs';
import { UNROUTED_ID } from '../projects/project-store.mjs';
import { validateAutomation, validateSync } from '../monitoring/automation-settings.mjs';

// The agent workspace: one folder per project (SPEC-projects-01 FR-19), laid out exactly like the plugin's
// own client workspace so the plugin's setup, workflow and knowledge skills and our UI
// read and write the same files. `<WORKSPACE_DIR>/projects/<id>/` is one project's; the shared library
// (`<WORKSPACE_DIR>/library/{knowledge,skills}/`) holds what an admin grants to projects, and a grant
// shows up in the project as a link at `knowledge/<name>` or `.claude/skills/<name>`.
//
//   operations.yaml        the only configuration file (Settings and Connectors edit it)
//   CLAUDE.md              operator guidance copied from the plugin
//   .mcp.json              rendered from operations.yaml connections
//   .claude/skills/<name>  custom skills uploaded as zip
//   knowledge/<name>/      one folder per Git knowledge base
//   workflows/<name>.yaml  routines
//   tasks/<taskId>/        per-task working folder

const CLAUDE_MD = `# Operations workspace

Use \`operations.yaml\` for stable mappings, connection names, and authority boundaries. Use \`knowledge/\` or the configured knowledge MCP for SOPs, definitions, owners, runbooks, and templates.

Do not place credentials in this repository. Start with read-only work, read provider state back after material writes, and verify outcomes before claiming completion.
`;
const REMOTE_TRANSPORTS = new Set(['http', 'sse', 'ws']);
const PASSTHROUGH = ['headers', 'env', 'oauth'];
const SECTIONS = ['team', 'sync', 'ticketing', 'platforms', 'identity', 'source_control', 'branding', 'documents', 'communication', 'knowledge', 'policy', 'connections', 'routines', 'connectors', 'agent', 'tickets', 'ui', 'automation', 'fixes'];
// smtp: a mail server the communication skill's send_email.py reaches with SMTP_* variables.
const CONNECTION_KINDS = ['mcp', 'cli', 'api', 'native', 'smtp'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const frontmatter = text => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  try { const data = YAML.parse(match[1]); return data && typeof data === 'object' ? data : {}; } catch { return {}; }
};

/** Turn `connections` from operations.yaml into Claude Code's .mcp.json shape. Mirrors the plugin's render_mcp.py. */
export function renderMcpServers(operations = {}) {
  const servers = {};
  for (const [rawName, connection] of Object.entries(operations.connections || {})) {
    const name = String(rawName);
    if (!connection || typeof connection !== 'object') throw new Error(`connection ${name} must be a mapping`);
    if (connection.kind !== 'mcp' || connection.enabled === false) continue;
    const transport = connection.transport;
    let server;
    if (REMOTE_TRANSPORTS.has(transport)) {
      if (!String(connection.url || '').trim()) throw new Error(`connection ${name} requires url`);
      server = { type: transport, url: connection.url };
    } else if (transport === 'stdio') {
      if (!String(connection.command || '').trim()) throw new Error(`connection ${name} requires command`);
      server = { type: 'stdio', command: connection.command };
      if (connection.args !== undefined) { if (!Array.isArray(connection.args)) throw new Error(`connection ${name} args must be a list`); server.args = connection.args; }
    } else throw new Error(`connection ${name} has unsupported MCP transport ${JSON.stringify(transport)}`);
    for (const field of PASSTHROUGH) if (connection[field] !== undefined) { if (!connection[field] || typeof connection[field] !== 'object') throw new Error(`connection ${name} ${field} must be a mapping`); server[field] = connection[field]; }
    servers[name] = server;
  }
  return { mcpServers: servers };
}

/** Local checks in the spirit of the plugin's check_workspace.py: structure, references, no secrets. */
export function validateOperations(operations) {
  const errors = []; const warnings = [];
  if (!operations || typeof operations !== 'object') return { errors: ['operations.yaml must contain a mapping'], warnings };
  const unknown = Object.keys(operations).filter(key => !SECTIONS.includes(key));
  if (unknown.length) warnings.push(`operations.yaml has unrecognized top-level sections: ${unknown.join(', ')}`);
  const team = operations.team;
  if (!team || typeof team !== 'object') errors.push('team must be a mapping');
  else { if (!String(team.name || '').trim()) errors.push('team.name is required'); if (!String(team.timezone || '').trim()) errors.push('team.timezone is required'); }
  const connections = operations.connections || {};
  if (typeof connections !== 'object' || Array.isArray(connections)) errors.push('connections must be a mapping');
  else for (const [name, connection] of Object.entries(connections)) {
    if (!connection || typeof connection !== 'object') { errors.push(`connections.${name} must be a mapping`); continue; }
    if (!CONNECTION_KINDS.includes(connection.kind)) errors.push(`connections.${name}.kind must be ${CONNECTION_KINDS.join(', ')}`);
    if (connection.kind === 'mcp') { try { renderMcpServers({ connections: { [name]: connection } }); } catch (error) { errors.push(error.message); } }
    if (connection.kind === 'cli' && !String(connection.command || '').trim()) errors.push(`connections.${name}.command is required for a CLI connection`);
    if (connection.kind === 'smtp' && !connection.env?.SMTP_HOST) errors.push(`connections.${name}.env must set SMTP_HOST for an SMTP connection`);
  }
  const walk = (value, location) => {
    if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${location}[${index}]`));
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      const here = location ? `${location}.${key}` : key;
      if (key === 'connection' && child) { if (typeof child !== 'string') errors.push(`${here} must be a connection name`); else if (!connections[child]) errors.push(`${here} references unknown connection: ${child}`); }
      if (/(^|_)(password|passwd|token|secret|client_secret|private_key|api_key|access_key)($|_)/i.test(key) && child && !/^\$\{[A-Z][A-Z0-9_]*(?::-[^}]*)?\}$/.test(String(child))) errors.push(`possible committed secret at ${here}`);
      walk(child, here);
    }
  };
  walk(operations, '');
  errors.push(...validateAgentSection(operations.agent));
  errors.push(...validateSync(operations.sync), ...validateAutomation(operations.automation), ...validateFixes(operations.fixes));
  const window = operations.tickets?.recurrenceWindowDays;
  if (window !== undefined && window !== null && !(Number.isInteger(window) && window >= 0 && window <= 365)) errors.push('tickets.recurrenceWindowDays must be a whole number of days from 0 to 365');
  const policy = operations.policy || {};
  if (policy && typeof policy === 'object' && !('default_write' in policy)) warnings.push('policy.default_write is missing; routine changes are allowed');
  errors.push(...validatePolicySection(policy, { categories: POLICY_CATEGORIES }));
  return { errors, warnings };
}

/** fixes.sandbox names the one schema per platform the fix tools may write without asking (SPEC-tasks-13 FR-1). */
function validateFixes(fixes) {
  if (fixes === undefined || fixes === null) return [];
  if (typeof fixes !== 'object' || Array.isArray(fixes)) return ['fixes must be a mapping'];
  const sandbox = fixes.sandbox ?? {};
  if (typeof sandbox !== 'object' || Array.isArray(sandbox)) return ['fixes.sandbox must be a mapping of platform to schema'];
  const errors = [];
  for (const [provider, schema] of Object.entries(sandbox)) {
    if (!['databricks', 'snowflake'].includes(provider)) errors.push(`fixes.sandbox.${provider} is not a platform; use databricks or snowflake`);
    else if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(String(schema || ''))) errors.push(`fixes.sandbox.${provider} must be catalog.schema (database.schema on Snowflake)`);
  }
  return errors;
}

/** Inside a copied (not linked) grant: marks it as the library's, so it is neither mistaken for the project's own nor synced. */
export const GRANT_COPY_MARKER = '.grant-copy';

/** Is this directory entry a folder, or a link to one (a granted base or skill)? */
async function isFolder(dir, entry) {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try { return (await fs.stat(path.join(dir, entry.name))).isDirectory(); } catch { return false; }
}

export class Workspace {
  // `libraryDir` is the shared library the grant links point at; a workspace without one (a single fixed folder) takes no grants.
  constructor({ dir = WORKSPACE_DIR, pluginDir = PLUGIN_DIR, projectId = null, libraryDir = null } = {}) { this.dir = path.resolve(dir); this.pluginDir = path.resolve(pluginDir); this.projectId = projectId; this.libraryDir = libraryDir ? path.resolve(libraryDir) : null; this.queue = Promise.resolve(); }
  get operationsPath() { return path.join(this.dir, 'operations.yaml'); }
  get mcpPath() { return path.join(this.dir, '.mcp.json'); }
  get knowledgeDir() { return path.join(this.dir, 'knowledge'); }
  get workflowsDir() { return path.join(this.dir, 'workflows'); }
  get skillsDir() { return path.join(this.dir, '.claude', 'skills'); }
  get tasksDir() { return path.join(this.dir, 'tasks'); }
  /** Uploaded client document templates (Settings > Templates), one subfolder per format. */
  get templatesDir() { return path.join(this.dir, 'templates'); }

  /** Create the folder layout and seed operations.yaml from the plugin template when missing. */
  async init() {
    for (const dir of [this.dir, this.knowledgeDir, this.workflowsDir, this.skillsDir, this.tasksDir, this.templatesDir]) await ensureDir(dir);
    if (!(await exists(this.operationsPath))) {
      const template = path.join(this.pluginDir, 'skills', 'setup', 'assets', 'operations.template.yaml');
      const text = (await exists(template)) ? await fs.readFile(template, 'utf8') : 'team:\n  name: ""\n  timezone: ""\nconnections: {}\n';
      // NerveCenter's starting policy: routine changes run, sensitive categories ask. Comments in the template survive.
      const doc = YAML.parseDocument(text);
      for (const [key, value] of Object.entries(APP_POLICY_DEFAULTS)) doc.setIn(['policy', key], value);
      await fs.writeFile(this.operationsPath, doc.toString(), 'utf8');
    }
    const claudeMd = path.join(this.dir, 'CLAUDE.md');
    if (!(await exists(claudeMd))) await fs.writeFile(claudeMd, CLAUDE_MD, 'utf8');
    await this.renderMcp();
    return this;
  }
  async #exclusive(task) { const prior = this.queue; let release; this.queue = new Promise(resolve => { release = resolve; }); await prior; try { return await task(); } finally { release(); } }

  /* ------------------------------------------------------------ operations.yaml */

  async readOperationsText() { return fs.readFile(this.operationsPath, 'utf8'); }
  async readOperations() { const value = YAML.parse(await this.readOperationsText()); return value && typeof value === 'object' ? value : {}; }
  /** Apply a change to operations.yaml keeping the template's comments where the section survives. */
  async updateOperations(mutator) {
    return this.#exclusive(async () => {
      const doc = YAML.parseDocument(await this.readOperationsText());
      const current = doc.toJS() || {};
      const next = (await mutator(clone(current))) || current;
      for (const key of Object.keys(next)) doc.set(key, next[key]);
      for (const key of Object.keys(current)) if (!(key in next)) doc.delete(key);
      await fs.writeFile(this.operationsPath, doc.toString({ lineWidth: 0 }), 'utf8');
      await this.renderMcp(next);
      return next;
    });
  }
  async getSection(name) { const operations = await this.readOperations(); return operations[name] ?? null; }
  async setSection(name, value) {
    if (!SECTIONS.includes(name)) throw new Error(`Unknown operations.yaml section: ${name}`);
    if (name === 'agent') { const problems = validateAgentSection(value); if (problems.length) throw new Error(problems.join('; ')); }
    if (name === 'policy') { const problems = validatePolicySection(value, { categories: POLICY_CATEGORIES }); if (problems.length) throw new Error(problems.join('; ')); }
    // SPEC-platform-10 FR-3, SPEC-automations-01 FR-3: a bad cadence or automation never reaches operations.yaml.
    if (name === 'sync') { const problems = validateSync(value); if (problems.length) throw httpError(400, problems.join('; ')); }
    if (name === 'automation') { const problems = validateAutomation(value); if (problems.length) throw httpError(400, problems.join('; ')); }
    return (await this.updateOperations(current => ({ ...current, [name]: value })))[name]; }
  async validate() { return validateOperations(await this.readOperations()); }

  /* ---------------------------------------------------------------- connections */

  async listConnections() { const operations = await this.readOperations(); return Object.entries(operations.connections || {}).map(([name, spec]) => ({ name, ...(spec || {}) })); }
  async setConnection(name, spec) {
    const key = slug(name); if (!SLUG.test(key)) throw new Error('Connection name must be a lowercase slug');
    if (!spec || !CONNECTION_KINDS.includes(spec.kind)) throw new Error(`Connection kind must be ${CONNECTION_KINDS.join(', ')}`);
    if (spec.kind === 'mcp') renderMcpServers({ connections: { [key]: spec } });
    const next = await this.updateOperations(current => ({ ...current, connections: { ...(current.connections || {}), [key]: clone(spec) } }));
    return { name: key, ...next.connections[key] };
  }
  async removeConnection(name) {
    let removed = false;
    await this.updateOperations(current => { const connections = { ...(current.connections || {}) }; removed = name in connections; delete connections[name]; return { ...current, connections }; });
    return removed;
  }
  async renderMcp(operations) { const rendered = renderMcpServers(operations || await this.readOperations()); await writeJson(this.mcpPath, rendered); return rendered; }
  async readMcp() { return (await exists(this.mcpPath)) ? JSON.parse(await fs.readFile(this.mcpPath, 'utf8')) : { mcpServers: {} }; }

  /* ------------------------------------------------------------------ routines */

  routinePath(name) { const key = slug(name); if (!SLUG.test(key)) throw new Error('Routine name must be a lowercase slug'); return safeJoin(this.workflowsDir, `${key}.yaml`); }
  async listRoutines() {
    const entries = (await exists(this.workflowsDir)) ? await fs.readdir(this.workflowsDir) : [];
    const items = [];
    for (const entry of entries.filter(file => /\.ya?ml$/.test(file)).sort()) {
      const file = path.join(this.workflowsDir, entry);
      try { const value = YAML.parse(await fs.readFile(file, 'utf8')); if (value && typeof value === 'object') items.push({ ...value, name: value.name || entry.replace(/\.ya?ml$/, ''), file: entry }); }
      catch (error) { items.push({ name: entry.replace(/\.ya?ml$/, ''), file: entry, error: `Invalid YAML: ${error.message}` }); }
    }
    return items;
  }
  async getRoutine(name) { const file = this.routinePath(name); if (!(await exists(file))) return null; const value = YAML.parse(await fs.readFile(file, 'utf8')); return { ...value, name: value?.name || slug(name), file: path.basename(file) }; }
  async saveRoutine(name, routine) {
    const key = slug(name); const file = this.routinePath(key);
    const value = { ...clone(routine), name: key };
    for (const required of ['objective', 'trigger']) if (!value[required]) throw new Error(`Routine ${required} is required`);
    if (!Array.isArray(value.success) || !value.success.length) value.success = ['the routine completes and its result is recorded as a task'];
    await ensureDir(this.workflowsDir);
    await fs.writeFile(file, YAML.stringify(value, { lineWidth: 0 }), 'utf8');
    return { ...value, file: path.basename(file) };
  }
  async deleteRoutine(name) { const file = this.routinePath(name); if (!(await exists(file))) return false; await fs.rm(file); return true; }

  /* ----------------------------------------------------------- knowledge bases */

  /** Folders under knowledge/, each optionally described by its index.md frontmatter. */
  async listKnowledgeFolders() {
    if (!(await exists(this.knowledgeDir))) return [];
    const entries = await fs.readdir(this.knowledgeDir, { withFileTypes: true });
    const items = [];
    for (const entry of entries.filter(item => !item.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!(await isFolder(this.knowledgeDir, entry))) continue;
      const index = path.join(this.knowledgeDir, entry.name, 'index.md');
      const meta = (await exists(index)) ? frontmatter(await fs.readFile(index, 'utf8')) : {};
      items.push({ name: entry.name, path: path.join('knowledge', entry.name), title: meta.title || entry.name, description: meta.description || '', hasIndex: await exists(index), shared: await this.isGrantLink('knowledge', entry.name) });
    }
    return items;
  }
  knowledgePath(name) { const key = slug(name); if (!SLUG.test(key)) throw new Error('Knowledge base name must be a lowercase slug'); return safeJoin(this.knowledgeDir, key); }
  /** knowledge/index.md pointing at every base, so the plugin's index-first retrieval works across bases. */
  async writeKnowledgeIndex() {
    const folders = await this.listKnowledgeFolders();
    const lines = ['---', 'type: Index', 'title: Knowledge bases', 'description: Entry point for every connected knowledge base. Open a base, then its own index.', 'status: stable', '---', '', ...folders.map(item => `- [${item.title}](${item.name}/${item.hasIndex ? 'index.md' : ''})${item.description ? `: ${item.description}` : ''}`)];
    await ensureDir(this.knowledgeDir);
    await fs.writeFile(path.join(this.knowledgeDir, 'index.md'), `${lines.join('\n')}\n`, 'utf8');
    return folders;
  }

  /* ------------------------------------------------------------------- skills */

  async #skillsIn(root, origin) {
    if (!(await exists(root))) return [];
    const entries = await fs.readdir(root, { withFileTypes: true });
    const items = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!(await isFolder(root, entry))) continue;
      const file = path.join(root, entry.name, 'SKILL.md');
      if (!(await exists(file))) continue;
      const meta = frontmatter(await fs.readFile(file, 'utf8'));
      items.push({ id: `${origin}:${entry.name}`, name: meta.name || entry.name, description: meta.description || '', origin, dir: path.join(root, entry.name), ...(origin === 'custom' && await this.isGrantLink('skills', entry.name) ? { shared: true } : {}) });
    }
    return items;
  }
  async listPluginSkills() { return this.#skillsIn(path.join(this.pluginDir, 'skills'), 'plugin'); }
  async listCustomSkills() { return this.#skillsIn(this.skillsDir, 'custom'); }
  async listSkills() { return [...(await this.listPluginSkills()), ...(await this.listCustomSkills())]; }
  skillDir(id) {
    const [origin, name] = String(id).split(':');
    if (!SLUG.test(name || '')) throw new Error('Invalid skill id');
    if (origin === 'plugin') return safeJoin(path.join(this.pluginDir, 'skills'), name);
    if (origin === 'custom') return safeJoin(this.skillsDir, name);
    throw new Error('Invalid skill id');
  }
  /** File tree and file reads for the Skills and Knowledge browsers. Paths never escape the root. */
  async tree(root, relative = '') {
    const base = safeJoin(root, relative);
    const entries = await fs.readdir(base, { withFileTypes: true });
    const items = [];
    for (const entry of entries.filter(item => !item.name.startsWith('.git') && !item.isSymbolicLink()).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      const rel = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
      if (entry.isDirectory()) items.push({ name: entry.name, path: rel, type: 'directory', children: await this.tree(root, rel) });
      else { const stat = await fs.stat(path.join(base, entry.name)); items.push({ name: entry.name, path: rel, type: 'file', size: stat.size }); }
    }
    return items;
  }
  async readFile(root, relative, { maxBytes = 2 * 1024 * 1024 } = {}) {
    const file = safeJoin(root, relative);
    // A link inside the folder (a file pointing out of it) never reads past the folder.
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
    if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) throw new Error('Path escapes allowed root');
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size > maxBytes) throw new Error(`File is larger than ${maxBytes} bytes`);
    return { path: relative.replaceAll('\\', '/'), size: stat.size, content: await fs.readFile(file, 'utf8') };
  }


  /* ------------------------------------------------------------- library grant links */

  /** Where a shared base or skill is kept: the library folder `kind` ('knowledge' or 'skills'). */
  libraryPath(kind, name) {
    if (!this.libraryDir) throw new Error('This workspace has no shared library');
    if (!SLUG.test(name)) throw new Error('Invalid name');
    return path.join(this.libraryDir, kind, name);
  }
  #grantTarget(kind) { return kind === 'knowledge' ? this.knowledgeDir : this.skillsDir; }

  /** True when `knowledge/<name>` or `.claude/skills/<name>` is a grant: a link into the library (or a marked copy of it). */
  async isGrantLink(kind, name) {
    const place = path.join(this.#grantTarget(kind === 'skills' ? 'skills' : 'knowledge'), name);
    try {
      const stat = await fs.lstat(place);
      if (stat.isSymbolicLink()) { if (!this.libraryDir) return false; const real = await fs.realpath(place); return real.startsWith(`${await fs.realpath(path.join(this.libraryDir, kind)).catch(() => path.join(this.libraryDir, kind))}${path.sep}`); }
      return stat.isDirectory() && await exists(path.join(place, GRANT_COPY_MARKER));
    } catch { return false; }
  }

  /**
   * Make the project folder match its grants (FR-31): a link for every granted base and skill that is in the library,
   * and no link for anything else. A name that is already a folder of the project's own is never replaced; it is
   * returned as a collision. Safe to run at any time; it only ever touches links it can tell are grants.
   */
  async applyLibraryGrants({ knowledge = [], skills = [] } = {}) {
    if (!this.libraryDir) return { linked: [], removed: [], collisions: [], missing: [] };
    const result = { linked: [], removed: [], collisions: [], missing: [] };
    for (const [kind, wanted] of [['knowledge', knowledge], ['skills', skills]]) {
      const home = this.#grantTarget(kind); await ensureDir(home);
      const names = new Set(wanted.map(String));
      for (const entry of await fs.readdir(home, { withFileTypes: true }).catch(() => [])) {
        if (names.has(entry.name) || !(await this.isGrantLink(kind, entry.name))) continue;
        await fs.rm(path.join(home, entry.name), { recursive: true, force: true }); result.removed.push(`${kind}/${entry.name}`);
      }
      for (const name of names) {
        const source = this.libraryPath(kind, name); const place = path.join(home, name);
        if (!(await exists(source))) { result.missing.push(`${kind}/${name}`); continue; }
        const present = await fs.lstat(place).catch(() => null);
        if (present) {
          if (await this.isGrantLink(kind, name)) { if (!present.isSymbolicLink()) await this.#refreshCopy(source, place); continue; }
          result.collisions.push(`${kind}/${name}`); continue;
        }
        try { await fs.symlink(path.relative(home, source), place, 'dir'); }
        catch { await fs.cp(source, place, { recursive: true }); await fs.writeFile(path.join(place, GRANT_COPY_MARKER), 'A copy of a shared library entry; changes are made in the library.\n', 'utf8'); }
        result.linked.push(`${kind}/${name}`);
      }
    }
    return result;
  }
  /** Link one library entry into this project (a grant that was just made), without touching any other link. */
  async linkLibraryEntry(kind, name) {
    if (!this.libraryDir) return 'none';
    const home = this.#grantTarget(kind); await ensureDir(home);
    const source = this.libraryPath(kind, name); const place = path.join(home, name);
    if (!(await exists(source))) return 'missing';
    const present = await fs.lstat(place).catch(() => null);
    if (present) {
      if (await this.isGrantLink(kind, name)) return 'present';
      throw httpError(409, `This project already has its own ${kind === 'skills' ? 'skill' : 'knowledge base'} named ${name}`);
    }
    try { await fs.symlink(path.relative(home, source), place, 'dir'); }
    catch { await fs.cp(source, place, { recursive: true }); await fs.writeFile(path.join(place, GRANT_COPY_MARKER), 'A copy of a shared library entry; changes are made in the library.\n', 'utf8'); }
    return 'linked';
  }
  /** Drop one grant link (a grant that was removed). Never removes a folder the project made itself. */
  async unlinkLibraryEntry(kind, name) {
    if (!(await this.isGrantLink(kind, name))) return false;
    await fs.rm(path.join(this.#grantTarget(kind), name), { recursive: true, force: true }); return true;
  }
  async #refreshCopy(source, place) { await fs.rm(place, { recursive: true, force: true }); await fs.cp(source, place, { recursive: true }); await fs.writeFile(path.join(place, GRANT_COPY_MARKER), 'A copy of a shared library entry; changes are made in the library.\n', 'utf8'); }

  /** Does a path inside this project's folder lead (by name) to a shared library entry? Used by the file guard and the sync. */
  async resolveReal(file) { return fs.realpath(file).catch(() => path.resolve(file)); }

  /* --------------------------------------------------------------------- tasks */

  async taskDir(taskId) { const key = String(taskId || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'task'; const dir = safeJoin(this.tasksDir, key); await ensureDir(dir); return dir; }
}

export async function createWorkspace(options) { return new Workspace(options).init(); }

/** The shared library: bases and skills an admin adds once and grants to projects (FR-31). Not a project, so it has no operations.yaml. */
export class LibraryWorkspace {
  constructor({ dir }) { this.dir = path.resolve(dir); }
  get knowledgeDir() { return path.join(this.dir, 'knowledge'); }
  get skillsDir() { return path.join(this.dir, 'skills'); }
  async init() { await ensureDir(this.knowledgeDir); await ensureDir(this.skillsDir); return this; }
  knowledgePath(name) { const key = slug(name); if (!SLUG.test(key)) throw new Error('Knowledge base name must be a lowercase slug'); return safeJoin(this.knowledgeDir, key); }
  skillPath(name) { const key = slug(name); if (!SLUG.test(key)) throw new Error('Skill name must be a lowercase slug'); return safeJoin(this.skillsDir, key); }
  async listKnowledgeFolders() {
    const entries = await fs.readdir(this.knowledgeDir, { withFileTypes: true }).catch(() => []);
    const items = [];
    for (const entry of entries.filter(item => item.isDirectory() && !item.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
      const index = path.join(this.knowledgeDir, entry.name, 'index.md');
      const meta = (await exists(index)) ? frontmatter(await fs.readFile(index, 'utf8')) : {};
      items.push({ name: entry.name, path: path.join('knowledge', entry.name), title: meta.title || entry.name, description: meta.description || '', hasIndex: await exists(index) });
    }
    return items;
  }
  async listSkillNames() {
    const entries = await fs.readdir(this.skillsDir, { withFileTypes: true }).catch(() => []);
    const names = [];
    for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) if (await exists(path.join(this.skillsDir, entry.name, 'SKILL.md'))) names.push(entry.name);
    return names;
  }
  /** Shared by the workspace's own readers: the same file and tree reads, bounded to a root. */
  tree(root, relative) { return Workspace.prototype.tree.call(this, root, relative); }
  readFile(root, relative, options) { return Workspace.prototype.readFile.call(this, root, relative, options); }
}

/**
 * Every project's workspace (FR-19): `for(projectOrScope)` returns that project's instance, built once and seeded like
 * a first start. The Unrouted queue and the admin All view have no workspace and are refused.
 */
export class WorkspaceRegistry extends PerProject {
  constructor({ root = WORKSPACE_DIR, pluginDir = PLUGIN_DIR } = {}) {
    super(id => new Workspace({ dir: path.join(this.root, 'projects', id), pluginDir: this.pluginDir, projectId: id, libraryDir: this.libraryDir }).init());
    this.root = path.resolve(root); this.pluginDir = path.resolve(pluginDir); this.libraryDir = path.join(this.root, 'library');
    this.libraryInstance = null;
  }
  async for(project) {
    if (projectIdOf(project) === UNROUTED_ID) throw httpError(403, 'The Unrouted queue has no workspace.');
    return super.for(project);
  }
  projectDir(id) { return path.join(this.root, 'projects', id); }
  async library() { return (this.libraryInstance ||= new LibraryWorkspace({ dir: this.libraryDir }).init()); }
  /** Ids of the project folders on disk (what a restore or a sweep sees before the project store is read). */
  async folders() { return (await fs.readdir(path.join(this.root, 'projects'), { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(); }
}

/** One fixed workspace behind the registry's interface: what a caller that has a single folder (a test, a script) passes. */
class FixedWorkspaces extends PerProject {
  constructor(workspace) { super(() => workspace); this.workspace = workspace; }
  async for() { return this.workspace; }
  async library() { throw new Error('A single fixed workspace has no shared library'); }
}
/** The registry a service works against: a registry as it is, a lone `Workspace` wrapped as the one folder every project shares. */
export function asRegistry(workspace) {
  if (!workspace) return null;
  return workspace instanceof PerProject ? workspace : new FixedWorkspaces(workspace);
}
