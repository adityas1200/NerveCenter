import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// SPEC-projects-01 FR-46: the file tools of one project's agent stay inside what that project may use. The agent runs with its
// project's workspace as cwd; this check (called from the permission gate before anything else) resolves every path the tool
// names, following symlinks, and refuses a path outside:
//   - the project workspace (read and write),
//   - the library entries granted to the project (read only: they are reached through the grant links in the workspace),
//   - the plugin folder (read only),
//   - the SDK's own folder for this session's spilled tool results (read only), and
//   - for the task that builds a shared knowledge base from uploads, that base and its uploaded documents (read and write).
// It covers Read, Grep, Glob, Edit, Write, MultiEdit and NotebookEdit. Bash is not covered (SPEC-projects-01 Known gaps).

const FILE_TOOLS = { Read: ['file_path'], Write: ['file_path'], Edit: ['file_path'], MultiEdit: ['file_path'], NotebookEdit: ['notebook_path'], Grep: ['path'], Glob: ['path'] };
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const GLOB_CHARS = /[*?[\]{}]/;

export const isPathTool = toolName => Object.hasOwn(FILE_TOOLS, toolName);

const inside = (root, file) => file === root || file.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
const realOrSelf = file => fs.realpath(file).catch(() => path.resolve(file));

/** The real location of a path that may not exist yet: the real path of its deepest existing ancestor plus the rest. */
export async function resolveReal(file) {
  let current = path.resolve(file); const rest = [];
  for (;;) {
    try { return path.join(await fs.realpath(current), ...rest.reverse()); }
    catch { const parent = path.dirname(current); if (parent === current) return path.resolve(file); rest.push(path.basename(current)); current = parent; }
  }
}

/** The real folders of the grant links in a project workspace (knowledge bases and skills it was granted). */
async function grantedRoots(workspace, grants) {
  const roots = [];
  for (const [kind, dir] of [['knowledge', workspace.knowledgeDir], ['skills', workspace.skillsDir]]) {
    if (!dir) continue;
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isSymbolicLink()) continue;
      // With the project's grants at hand, a link nobody granted (made by hand) opens nothing.
      if (grants && !grants[kind]?.has(entry.name)) continue;
      const real = await fs.realpath(path.join(dir, entry.name)).catch(() => null);
      if (real && workspace.libraryDir && inside(await realOrSelf(workspace.libraryDir), real)) roots.push(real);
    }
  }
  return roots;
}

/** Where the SDK keeps a session's spilled tool results: <config dir>/projects/<cwd with non-alphanumerics as dashes>/. */
function sdkSessionDir(cwd) { return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-')); }

/**
 * Check one tool call. Returns `{ allowed: true }` or `{ allowed: false, reason, path }`. `workspace` is the task's project
 * workspace, `grants` the project's knowledge and skill grants as `{ knowledge: Set, skills: Set }` (omit to trust the links), `task` the task (its context names a shared base the task builds), `pluginDir` the plugin folder.
 */
export async function checkPathAccess({ toolName, input = {}, workspace, task = null, pluginDir, grants = null }) {
  const fields = FILE_TOOLS[toolName];
  if (!fields) return { allowed: true };
  const cwd = workspace.dir;
  const targets = [];
  for (const field of fields) { const value = input?.[field]; if (typeof value === 'string' && value.trim()) targets.push(value); }
  // Glob patterns can reach out on their own ("/etc/*", "../beta/**"): check the fixed part in front of the first wildcard.
  if (toolName === 'Glob' && typeof input?.pattern === 'string') {
    const pattern = input.pattern;
    if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) {
      const segments = pattern.split(/[\\/]/); const fixed = []; for (const segment of segments) { if (GLOB_CHARS.test(segment)) break; fixed.push(segment); }
      const base = input?.path && typeof input.path === 'string' ? path.resolve(cwd, input.path) : cwd;
      targets.push(path.resolve(base, fixed.join(path.sep) || '.'));
    }
  }
  if (!targets.length) return { allowed: true }; // no path given: the tool works in cwd, the project workspace
  const writable = [await realOrSelf(cwd)];
  const readable = [...writable, ...await grantedRoots(workspace, grants)];
  if (pluginDir) readable.push(await realOrSelf(pluginDir));
  readable.push(await realOrSelf(sdkSessionDir(cwd)).catch(() => sdkSessionDir(cwd)));
  // The task that builds a shared base from uploads works in the library, on that base and its documents only.
  if (task?.context?.sharedBase && task?.context?.knowledgeBase && workspace.libraryDir) {
    const key = String(task.context.knowledgeBase);
    if (/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) for (const sub of [path.join('knowledge', key), path.join('knowledge-uploads', key)]) { const root = await resolveReal(path.join(workspace.libraryDir, sub)); writable.push(root); readable.push(root); }
  }
  const readOnly = READ_ONLY_TOOLS.has(toolName);
  const allowedRoots = readOnly ? readable : writable;
  for (const target of targets) {
    const real = await resolveReal(path.resolve(cwd, target));
    if (allowedRoots.some(root => inside(root, real))) continue;
    const inReadOnlyPlace = !readOnly && readable.some(root => inside(root, real));
    return { allowed: false, path: target, reason: inReadOnlyPlace
      ? `${target} is shared and read-only here; this project can read it but not change it.`
      : `${target} is outside this project's workspace. Work only with the files in your project folder and the shared knowledge and skills granted to this project.` };
  }
  return { allowed: true };
}
