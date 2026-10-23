import fs from 'node:fs';
import path from 'node:path';
import { evaluateRules, normalizeRules, resourceString } from './policy-rules.mjs';
import { TOOL_CATEGORIES } from './nervecenter-tool-categories.mjs';

// Decides what happens when the agent wants to use a tool.
//
// Every tool call is first put in one category:
//   read               looking at something (files, APIs, queries, the app's own data)
//   task_files         writing inside the task's own folder, where its files belong
//   email_send         sending mail
//   privileged_access  granting or revoking access (identity, groups, SQL GRANT/REVOKE)
//   production_changes running, repairing or changing production jobs, non-SELECT SQL, git push
//   ticket_writes      creating, closing or transitioning tickets in ServiceNow, Jira or NerveCenter
//   knowledge_drafts   saving a lesson as a draft through update_knowledge (a person keeps or discards it later)
//   workspace_changes  editing operations.yaml, .mcp.json, workflows, knowledge or skills
//   default_write      any other change
//
// Then the task's permission decides:
//   read-only  only read and task_files run; everything else is denied
//   policy     the Policy in operations.yaml decides per category (allow, ask or deny); the default
//   ask        every change pauses for a person
//   allow      every change runs
// The plugin's own rules (confirm target, read back, verify) still apply on top of this.

export const PERMISSIONS = ['read-only', 'policy', 'ask', 'allow'] as const;
export type Permission = typeof PERMISSIONS[number];
export const POLICY_CATEGORIES = ['email_send', 'privileged_access', 'production_changes', 'ticket_writes', 'workspace_changes', 'knowledge_drafts', 'default_write'] as const;
export type PolicyCategory = typeof POLICY_CATEGORIES[number];
export type ToolCategory = 'read'|'task_files'|PolicyCategory;
type PolicyDecision = 'allow'|'ask'|'deny';
type ToolInput = Record<string,unknown>;
type PolicyShape = Partial<Record<PolicyCategory,unknown>> & {rules?:unknown};
type PolicyContext = {taskDir?:string;cwd?:string;functions?:Set<string>};
type PlatformEnvironment = {workspace?:unknown;account?:unknown};
type PolicyPlatform = {type?:unknown;name?:unknown;environments?:Record<string,PlatformEnvironment>};
type PolicyOptions = {taskDir?:string;platforms?:PolicyPlatform[];permission?:Permission|string;policy?:PolicyShape};
type ResourceObject = {type:string;name:string};
// Knowledge drafts run without a prompt: they are uncommitted, marked draft, and a person keeps or discards each one.
export const POLICY_DEFAULTS:Record<PolicyCategory,PolicyDecision> = { email_send: 'ask', privileged_access: 'ask', production_changes: 'ask', ticket_writes: 'ask', workspace_changes: 'ask', knowledge_drafts: 'allow', default_write: 'allow' };
export const CATEGORY_LABELS:Record<ToolCategory,string> = { read: 'Read', task_files: 'Task files', email_send: 'Send email', privileged_access: 'Access change', production_changes: 'Production change', ticket_writes: 'Ticket change', workspace_changes: 'Workspace config', knowledge_drafts: 'Knowledge draft', default_write: 'Change' };
const SEVERITY:ToolCategory[] = ['read', 'task_files', 'default_write', 'knowledge_drafts', 'workspace_changes', 'ticket_writes', 'production_changes', 'privileged_access', 'email_send'];
const worst = (categories:ToolCategory[]):ToolCategory => categories.reduce<ToolCategory>((a, b) => (SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a), 'read');

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Skill', 'Task', 'Agent', 'TodoWrite', 'TodoRead', 'NotebookRead', 'BashOutput', 'KillShell', 'ToolSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'Monitor', 'TaskOutput', 'TaskStop']);
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const READ_VERBS = /^(get|list|search|read|fetch|describe|query|find|show|lookup|status|count|history|preview|check|browse|view|retrieve|inspect|explain|summar|compare|diff|export|app_overview|data_quality)/i;
const normalizePolicyRules = normalizeRules as unknown as (rules:unknown, options:{categories:string[]})=>{rules:unknown[]};
const evaluatePolicyRules = evaluateRules as unknown as (rules:unknown[], options:{action:ToolCategory;resources:string[]})=>{effect:PolicyDecision;action:string;resource:string;description?:string}|null;

// NerveCenter's own tools (the in-process MCP server) declare their category next to their definition.

/* ------------------------------------------------------------------ helpers */

/** Split on ; | || && and newlines, but not inside single or double quotes (a grep pattern such as "a|b" stays whole). */
export function splitStatements(text:string):string[] {
  const out = []; let current = ''; let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { current += ch; if (ch === quote && text[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') { if (ch === '&' && text[i + 1] !== '&') { current += ch; continue; } out.push(current); current = ''; if ((ch === '|' || ch === '&') && text[i + 1] === ch) i++; continue; }
    if (ch === '\r') continue;
    current += ch;
  }
  out.push(current);
  return out.map(s => s.trim()).filter(Boolean);
}

function insideDir(root:string, target:string):boolean {
  const fold = (value:string) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const resolvedRoot = fold(path.resolve(root)); const resolved = fold(path.resolve(path.resolve(root), target));
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}
// Git Bash paths (/c/Users/...) resolve to Windows paths.
const toNative: (target: string) => string = target => (process.platform === 'win32' && /^\/[a-z]\//i.test(target) ? `${target[1]}:${target.slice(2)}` : target);
const unquote: (value: unknown) => string = value => String(value || '').replace(/^["']|["']$/g, '');

/** Where a file path lands: the task folder, workspace config, or somewhere else. */
function categorizePath(target:string, { taskDir, cwd }:PolicyContext):ToolCategory {
  const raw = toNative(unquote(target)); if (!raw || raw === '/dev/null' || raw.toLowerCase() === 'nul' || raw.startsWith('$null')) return 'read';
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(cwd || '.', raw);
  if (taskDir && insideDir(taskDir, absolute)) return 'task_files';
  const workspaceDir = taskDir ? path.dirname(path.dirname(taskDir)) : null;
  if (workspaceDir && insideDir(workspaceDir, absolute)) {
    const rel = path.relative(workspaceDir, absolute).replaceAll('\\', '/');
    if (/^(operations\.ya?ml|\.mcp\.json|workflows\/|knowledge\/|\.claude\/|CLAUDE\.md)/i.test(rel)) return 'workspace_changes';
  }
  return 'default_write';
}

/* -------------------------------------------------------------- network calls */

const WRITE_METHOD = /\s(?:-X|--request)\s*["']?(POST|PUT|PATCH|DELETE)\b|-Method\s+["']?(Post|Put|Patch|Delete)\b|requests\.(post|put|patch|delete)\s*\(|method\s*=\s*["'](POST|PUT|PATCH|DELETE)["']|\.(post|put|patch|delete)\(\s*["'`]|fetch\([^)]*method\s*:\s*["'](POST|PUT|PATCH|DELETE)["']|--method\s+(post|put|patch|delete)\b/i;
const DATA_FLAG = /\s(?:-d|--data(?:-raw|-binary|-urlencode)?|--json|-F|--form|-T|--upload-file)(?:\s|=)|\s-Body\s|\s-InFile\s|urllib\.request\.Request\([^)]*data\s*=/i;
const READ_POST_URL = /\/api\/2\.0\/sql\/statements\b|\/rest\/api\/(?:2|3|latest)\/search\b|\/graphql\b/i;
const SQL_WRITE = /(?:^|["'\s(\\])(INSERT\s+(?:INTO|OVERWRITE)|UPDATE\s+[\w.`]+\s+SET|DELETE\s+FROM|MERGE\s+INTO|DROP\s+(?:TABLE|VIEW|SCHEMA|DATABASE|CATALOG|FUNCTION)|TRUNCATE\s+TABLE|ALTER\s+(?:TABLE|VIEW|SCHEMA)|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|SCHEMA|FUNCTION)|COPY\s+INTO|OPTIMIZE\s|VACUUM\s|RESTORE\s+TABLE)\b/i;
const SQL_ACCESS = /(?:^|["'\s(\\])(GRANT\s+\w+|REVOKE\s+\w+)/i;

function categorizeUrlWrite(text:string):ToolCategory {
  if (/\/mail\b|\/sendmail|\/messages\/send|sendMail|\/smtp|\/outbox\b|\/send-email|\/email\/send/i.test(text)) return 'email_send';
  if (/\/identity\/|\/scim\/|\/api\/2\.0\/(?:preview\/)?(?:permissions|scim)|\/groups\b|\/members\b|\/approvals\/|\/role(?:s|Assignments)?\b|\/grants?\b|\/entitlements\b|\/access\b/i.test(text)) return 'privileged_access';
  if (/\/jobs\/(?:run-now|runs\/(?:submit|repair|cancel|delete)|create|update|reset|delete)|\/pipelines\/[^/\s"']+\/(?:updates|stop)|\/clusters\/(?:start|restart|delete|edit|create)|\/warehouses\/[^/\s"']+\/(?:start|stop)|\/workspace\/(?:import|delete|mkdirs)|\/dbfs\/(?:put|delete|move|mkdirs)/i.test(text)) return 'production_changes';
  if (/\/api\/now\/(?:table|v\d\/table)\/(?:incident|sc_task|sc_req_item|change_request|problem)/i.test(text)) return /-X\s*["']?POST|-Method\s+["']?Post|requests\.post/i.test(text) || /["']?(?:state|close_code|close_notes|resolved_at)["']?\s*[:=]/i.test(text) ? 'ticket_writes' : 'default_write';
  if (/\/rest\/api\/(?:2|3|latest)\/issue\/[^/\s"']+\/transitions|\/rest\/api\/(?:2|3|latest)\/issue\/?(?:["'\s?]|$)|\/rest\/api\/(?:2|3|latest)\/issue\/bulk/i.test(text)) return 'ticket_writes';
  return 'default_write';
}

/* --------------------------------------------------------------- shell commands */

// Signals that a script (python -c, node -e, or a script file) writes something.
function categorizeScript(code:string, ctx:PolicyContext):ToolCategory {
  const found:ToolCategory[] = [];
  if (SQL_ACCESS.test(code)) found.push('privileged_access');
  else if (SQL_WRITE.test(code)) found.push('production_changes');
  if (WRITE_METHOD.test(code) || /urllib\.request\.Request\([^)]*data\s*=|http\.client[\s\S]*\.request\(\s*["'](?:POST|PUT|PATCH|DELETE)/i.test(code)) found.push(categorizeUrlWrite(code));
  if (/smtplib|send_message\(|sendmail\(/i.test(code)) found.push('email_send');
  for (const match of code.matchAll(/open\(\s*(?:r|f)?["']([^"']+)["']\s*,\s*["'][^"']*[wax+][^"']*["']/g)) found.push(categorizePath(match[1], ctx));
  for (const match of code.matchAll(/(?:writeFileSync|writeFile|appendFileSync|write_text|write_bytes|to_csv|to_json|to_parquet|json\.dump)\(\s*(?:[\w.]+\s*,\s*)?["']([^"']+)["']/g)) found.push(categorizePath(match[1], ctx));
  if (/(?:writeFileSync|writeFile|write_text|to_csv|shutil\.(?:rmtree|move|copy)|os\.(?:remove|unlink|rename|makedirs|rmdir)|rmSync|unlinkSync|renameSync)\(/i.test(code) && !found.length) found.push('default_write');
  if (/subprocess|os\.system|child_process|execSync|spawnSync/i.test(code)) found.push(...[...code.matchAll(/["']((?:git|curl|databricks|rm|mv)\s[^"']+)["']/g)].map(m => categorizeCommand(m[1], ctx)));
  return worst(found);
}

function readScript(file:string, ctx:PolicyContext):string|null {
  try {
    const raw = toNative(unquote(file)); const absolute = path.isAbsolute(raw) ? raw : path.resolve(ctx.cwd || '.', raw);
    const stat = fs.statSync(absolute); if (!stat.isFile() || stat.size > 500_000) return null;
    return fs.readFileSync(absolute, 'utf8');
  } catch { return null; }
}

function categorizeStatement(statement:string, ctx:PolicyContext):ToolCategory {
  const s = statement.trim(); if (!s) return 'read';
  const found:ToolCategory[] = [];
  // Redirects write files: > file, >> file, 2> file. ">=" and "a > 5" inside SQL or JSON are comparisons.
  for (const match of s.matchAll(/(?<![-\w=<])(?:\d?>>?|>)(?!=)\s*"?([^\s"'|;&()]+)"?/g)) { const target = match[1]; if (/^&?\d$/.test(target)) continue; if (!/[\\/]|\.\w+$/.test(target) && !/^\$/.test(target)) continue; found.push(categorizePath(target, ctx)); }
  for (const match of s.matchAll(/\b(?:Out-File|Set-Content|Add-Content|Tee-Object|tee)\s+(?:-(?:FilePath|Path|LiteralPath|Encoding\s+\S+|NoNewline|Append|a)\s+)*["']?([^\s"';|]+)/gi)) found.push(categorizePath(match[1], ctx));
  // Mail and platform CLIs.
  if (/\b(?:Send-MailMessage|sendmail|mailx?\s+-s)\b/i.test(s)) found.push('email_send');
  // The plugin's SMTP sender, even when its path is a variable the policy cannot read.
  if (/\bsend_email\.py\b/i.test(s)) found.push('email_send');
  if (/\bdatabricks\s+(?:groups|permissions|users|service-principals|grants|account)\s+(?!list|get)/i.test(s)) found.push('privileged_access');
  else if (/\bdatabricks\s+[\w-]+\s+(?:create|delete|update|run-now|submit|repair-run|cancel-run|cancel-all-runs|reset|start|stop|restart|edit|import|upload|rm|mv|cp|put|deploy|destroy|bundle\s+deploy)\b/i.test(s)) found.push('production_changes');
  if (/\bgit\s+(?:-C\s+\S+\s+)?(?:push|merge|rebase|reset\s+--hard)\b|\bgh\s+pr\s+(?:merge|create)\b/i.test(s)) found.push('production_changes');
  else if (/\bgit\s+(?:-C\s+(\S+)\s+)?(?:commit|add|checkout\s+-b|switch\s+-c|branch\s+-[dDmM]|stash|tag|apply|am|cherry-pick|restore|rm|mv|clean)\b/i.test(s)) { const dir = /\bgit\s+-C\s+(\S+)/i.exec(s)?.[1]; found.push(dir ? categorizePath(path.join(unquote(dir), 'x'), ctx) : ctx.cwd && ctx.taskDir && insideDir(ctx.taskDir, ctx.cwd) ? 'task_files' : categorizePath(path.join(ctx.cwd || '.', 'x'), ctx)); }
  // HTTP clients.
  if (/^(?:\$\w+\s*=\s*)?(?:curl(?:\.exe)?|wget|http|https|Invoke-RestMethod|Invoke-WebRequest|irm|iwr)\b/i.test(s)) {
    const writes = WRITE_METHOD.test(s) || DATA_FLAG.test(s);
    if (writes) {
      const readPost = READ_POST_URL.test(s) && !/\s(?:-F|--form|-T|--upload-file)\s/i.test(s) && !/\s(?:-X|--request)\s*["']?(?:PUT|PATCH|DELETE)|-Method\s+["']?(?:Put|Patch|Delete)/i.test(s);
      if (readPost) { if (/\/sql\/statements/i.test(s)) { const body = s.replace(/\\"|`"/g, '"'); if (SQL_ACCESS.test(body)) found.push('privileged_access'); else if (SQL_WRITE.test(body)) found.push('production_changes'); } }
      else found.push(categorizeUrlWrite(s));
    }
    for (const match of s.matchAll(/\s(?:-o|--output|-OutFile)\s+["']?([^\s"']+)/gi)) found.push(categorizePath(match[1], ctx));
    if (/\s(?:-O|--remote-name)\b/.test(s)) found.push(ctx.taskDir && ctx.cwd && insideDir(ctx.taskDir, ctx.cwd) ? 'task_files' : 'default_write');
  }
  // Scripts: inline code is scanned; a script file is read and scanned; an unreadable one counts as a change.
  const inline = /\b(?:python(?:3)?|py|node)(?:\.exe)?\s+(?:-\w+\s+)*-(?:c|e)\s+(["'])([\s\S]*)\1/i.exec(s) || /\b(?:python(?:3)?|py|node)(?:\.exe)?\s+(?:-\w+\s+)*-(?:c|e)\s+([\s\S]*)$/i.exec(s);
  if (inline) found.push(categorizeScript(inline[2] ?? inline[1], ctx));
  else { const file = /\b(?:python(?:3)?|py|node|bash|sh|pwsh|powershell)(?:\.exe)?\s+(?:-(?!c\b|e\b)[\w-]+\s+)*["']?([^\s"';|&]+\.(?:py|mjs|cjs|js|sh|ps1))["']?/i.exec(s); if (file) { const code = readScript(file[1], ctx); found.push(code === null ? 'default_write' : /\.(?:sh|ps1)$/i.test(file[1]) ? categorizeCommand(code, { taskDir: ctx.taskDir, cwd: ctx.cwd }) : categorizeScript(code, ctx)); } }
  // File system changes.
  const fileOp = /^(?:sudo\s+)?(rm|rmdir|del|erase|mv|move|cp|copy|touch|chmod|chown|ln|truncate|Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item|Clear-Content|mkdir|md)\b\s*(.*)$/i.exec(s);
  if (fileOp) {
    const verb = fileOp[1].toLowerCase(); const args = ` ${fileOp[2]}`.replace(/\s-(?:ItemType\s+\w+|Force|Recurse|Path|LiteralPath|Destination|p|r|rf|f|v|n|i)\b/gi, ' ').match(/"[^"]*"|'[^']*'|\S+/g) || [];
    const targets = ['cp', 'copy', 'copy-item', 'mv', 'move', 'move-item', 'ln'].includes(verb) ? args.slice(-1) : args.filter(arg => !arg.startsWith('-'));
    const sources = ['mv', 'move', 'move-item', 'rename-item'].includes(verb) ? args.slice(0, -1) : [];
    found.push(...(targets.length ? [...targets, ...sources].map(target => categorizePath(target, ctx)) : ['default_write' as ToolCategory]));
  }
  if (/\bsed\s+(?:-\w*\s+)*-[a-zA-Z]*i/.test(s)) { const file = s.match(/"[^"]*"|'[^']*'|\S+/g)?.at(-1); found.push(categorizePath(file || '', ctx)); }
  if (/^(?:npm|pnpm|yarn|pip|pip3|uv|poetry|choco|winget|apt|apt-get|brew)\s+(?:install|add|remove|uninstall|update|upgrade)\b/i.test(s)) found.push('default_write');
  if (/\b(?:Start-Process|Invoke-Expression|iex|Stop-Process|taskkill|kill|shutdown|Restart-Computer|Set-ItemProperty|reg\s+add|schtasks)\b/i.test(s)) found.push('default_write');
  // PowerShell cmdlets that change files can sit inside a script block ({ ... }) where the anchored check above misses them.
  if (/\b(?:Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item|Clear-Content|Set-Item|Export-Csv|Export-Clixml)\b/i.test(s) && !fileOp) found.push('default_write');
  if (selfApi(s)) found.push('privileged_access');
  if (!fileOp) found.push(categorizeProgram(s, ctx));
  return worst(found);
}

/* ------------------------------------------------------------- unknown programs */

// A command is a change unless it is known to only read: a program nobody listed here (psql, aws,
// kubectl, terraform, a vendor CLI) may write, so it is treated as one (fail closed). The rules
// above still decide the category of the commands they recognise.
const READ_PROGRAMS = new Set(['ls', 'dir', 'cat', 'type', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'findstr', 'wc', 'sort', 'uniq', 'cut', 'tr', 'awk', 'sed', 'jq', 'yq', 'echo', 'printf', 'pwd', 'cd', 'pushd', 'popd', 'which', 'where', 'whoami', 'hostname', 'date', 'cal', 'sleep', 'test', '[', 'basename', 'dirname', 'realpath', 'readlink', 'stat', 'file', 'du', 'df', 'tree', 'column', 'diff', 'cmp', 'md5sum', 'sha1sum', 'sha256sum', 'shasum', 'base64', 'xxd', 'od', 'strings', 'nl', 'tac', 'rev', 'fold', 'paste', 'join', 'comm', 'seq', 'expr', 'bc', 'env', 'printenv', 'uname', 'id', 'ps', 'curl', 'wget', 'http', 'https', 'nslookup', 'ping', 'dig', 'zcat',
  'select-string', 'select-object', 'where-object', 'foreach-object', 'sort-object', 'group-object', 'measure-object', 'format-table', 'format-list', 'format-wide', 'out-string', 'out-host', 'out-null', 'convertfrom-json', 'convertto-json', 'convertfrom-csv', 'convertto-csv', 'convertto-html', 'import-csv', 'write-output', 'write-host', 'write-verbose', 'write-error', 'join-path', 'split-path', 'test-path', 'resolve-path', 'test-connection', 'test-netconnection', 'resolve-dnsname', 'invoke-restmethod', 'invoke-webrequest', 'irm', 'iwr', 'start-sleep', 'compare-object', 'select-xml', 'tee-object', '%', '?', 'gci', 'gc', 'ls', 'sls', 'select', 'where', 'foreach', 'sort', 'measure', 'ft', 'fl']);
const SHELL_WORDS = /^(?:for|while|until|do|done|then|else|elif|fi|if|case|esac|in|function|try|catch|finally|return|break|continue|local|export|declare|set|unset|shift|true|false|:|begin|process|end|param|exit|trap|wait|read|source|\.)$/i;
const SQL_CLIS = new Set(['psql', 'snowsql', 'sqlcmd', 'mysql', 'bq', 'duckdb', 'sqlite3', 'beeline', 'spark-sql', 'trino', 'presto', 'clickhouse-client', 'dbsqlcli']);
const GIT_READS = /^(?:status|log|diff|show|branch|remote|rev-parse|rev-list|ls-files|ls-remote|ls-tree|cat-file|config\s+--get|describe|blame|shortlog|grep|reflog|tag\s+(?:-l|--list)|--version|help)\b/i;

/** The program a statement runs, with assignments, shell keywords, wrappers and the call operator peeled off. */
export function programOf(statement:string):{name:string;rest:string} {
  let s = statement.trim(); let called = false;
  for (let i = 0; i < 8; i += 1) {
    const before = s;
    s = s.replace(/^[{}()]+\s*/, '')
      .replace(/^[A-Za-z_][\w-]*\s*\([^)]*\)\s*\{?\s*/, '') // a function definition: q() {  /  P($n,$u){
      .replace(/^\$[\w:]+(?:\[[^\]]*\])?\s*[+*/-]?=\s*/, '') // PowerShell $x = …
      .replace(/^(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)(?:\s+|$))+/, '') // bash VAR=value [command]
      .replace(/^(?:sudo|time|nohup|command|builtin|exec)\s+/i, '').replace(/^timeout\s+\S+\s+/i, '').replace(/^env\s+(?:[A-Za-z_]\w*=\S*\s+)+/i, '').replace(/^xargs(?:\s+-\S+)*\s+/i, '');
    if (/^&\s*/.test(s)) { called = true; s = s.replace(/^&\s*/, ''); }
    const word = /^(\S+)/.exec(s)?.[1] || '';
    if (SHELL_WORDS.test(word)) s = s.slice(word.length).trim().replace(/^\w+\s+in\s+[^;]*$/i, '');
    if (s === before) break;
  }
  // PowerShell prints a bare string ("--- mcp ---"); only the call operator (&) runs a quoted path.
  if (!called && /^["']/.test(s)) return { name: '', rest: s };
  const raw = /^["']?([^\s"'|;]+)/.exec(s)?.[1] || '';
  return { name: raw.replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase(), rest: s.slice(raw.length).replace(/^["']/, '').trim() };
}

function categorizeProgram(statement:string, ctx:PolicyContext):ToolCategory {
  const { name, rest } = programOf(statement);
  // A .NET static call ([System.IO.File]::WriteAllText) reads only when the method is a known reader.
  if (/^\[[\w.]+\]::/.test(name)) return /^\[[\w.]+\]::(?:Get\w*|Exists|Read\w*|Parse\w*|TryParse|Join|Combine|Format|Now|UtcNow|Today|Round|Floor|Ceiling|Abs|Max|Min|Escape|Unescape|IsNullOr\w+|FromBase64String|ToBase64String|UrlEncode|UrlDecode|ToString|Equals|Compare)\b/i.test(`${name}${rest}`) ? 'read' : 'default_write';
  if (!name || name.startsWith('$') || name.startsWith('#') || /^[\d@[]/.test(name) || READ_PROGRAMS.has(name) || /^get-/.test(name)) return 'read';
  // A function this command defines: its body is judged statement by statement; SQL handed to it as an argument is judged here.
  if (ctx.functions?.has(name)) return SQL_ACCESS.test(rest) ? 'privileged_access' : SQL_WRITE.test(rest) ? 'production_changes' : 'read';
  if (name === 'find') return /\s-(?:delete|exec|execdir|ok|fprint\w*)\b/.test(rest) ? 'default_write' : 'read';
  if (name === 'git') {
    const sub = rest.replace(/^(?:-C\s+\S+\s+|-c\s+\S+\s+|--no-pager\s+)*/i, '');
    if (GIT_READS.test(sub)) return 'read';
    const clone = /^clone\s+(?:-\S+\s+(?:\S+\s+)?)*\S+\s+["']?([^\s"']+)/i.exec(sub);
    if (clone) return categorizePath(clone[1], ctx);
    return categorizePath(path.join(ctx.cwd || '.', 'x'), ctx); // fetch, pull, init… change the repository on disk
  }
  if (name === 'gh') {
    if (/^api\b/i.test(rest)) { const method = /(?:-X|--method)\s+["']?(\w+)/i.exec(rest)?.[1]; const fields = /\s(?:-f|-F|--field|--raw-field|--input)\s/.test(` ${rest} `); return (method && !/^get$/i.test(method)) || fields ? categorizeUrlWrite(rest) : 'read'; }
    return /^(?:pr|issue|repo|run|release|workflow|search|auth|status|gist|label|cache)\s+(?:view|list|status|diff|checks|watch|download|search)\b|^(?:search|status|--version)\b/i.test(rest) ? 'read' : 'default_write';
  }
  if (name === 'databricks') {
    const api = /^api\s+(get|head|post|put|patch|delete)\s+(\S+)/i.exec(rest);
    if (api) return /^(?:get|head)$/i.test(api[1]) ? 'read' : categorizeUrlWrite(`${api[2]} `);
    return /^(?:[\w-]+\s+)?(?:list|get|ls|cat|describe|show|status|export|summary|current-user|version|--version|help|auth\s+(?:describe|env|profiles|token))\b/i.test(rest) || /^(?:fs\s+(?:ls|cat))\b/i.test(rest) ? 'read' : 'default_write';
  }
  if (SQL_CLIS.has(name)) return SQL_ACCESS.test(rest) ? 'privileged_access' : SQL_WRITE.test(rest) ? 'production_changes' : 'read';
  // Inline code and script files were scanned above; here only what is left: stdin (python -), modules, versions.
  if (/^(?:python\d?(?:\.\d+)?|py|node)$/.test(name)) return /(?:^|\s)(?:-c|-e|--version|-V)\b|\.(?:py|mjs|cjs|js)\b|-m\s+(?:json\.tool|pytest|pydoc|pip\s+(?:list|show|freeze))\b/.test(rest) ? 'read' : /^-\s*(?:<<|$)/.test(rest) ? categorizeScript(rest, ctx) : 'default_write';
  if (/^(?:bash|sh|pwsh|powershell)$/.test(name)) {
    // bash -c "…" / pwsh -Command "…": the inner command decides. A script file was read and scanned above.
    const inner = /(?:^|\s)-(?:c|Command)\s+(["'])([\s\S]*)\1\s*$/i.exec(rest) || /(?:^|\s)-(?:c|Command)\s+([\s\S]+)$/i.exec(rest);
    if (inner) return categorizeCommand(inner[2] ?? inner[1], { taskDir: ctx.taskDir, cwd: ctx.cwd });
    return /\.(?:sh|ps1)\b/.test(rest) ? 'read' : 'default_write';
  }
  return 'default_write';
}

/** A call to NerveCenter's own API: the agent has the nervecenter tools and never needs to call the app as a person would. */
function selfApi(statement:string):boolean {
  const port = Number(process.env.PORT || 8787);
  const local = new RegExp(`(?:localhost|127\\.0\\.0\\.1|\\[::1\\]|0\\.0\\.0\\.0):${port}/api\\b`, 'i');
  const publicUrl = String(process.env.OPS_PUBLIC_URL || '').replace(/\/+$/, '');
  return local.test(statement) || Boolean(publicUrl && statement.includes(`${publicUrl}/api`));
}

/** The category of a shell command: the most sensitive thing any of its statements does. */
export function categorizeCommand(command:unknown, { taskDir, cwd }:PolicyContext = {}):ToolCategory {
  const workspaceDir = taskDir ? path.dirname(path.dirname(taskDir)) : undefined;
  const source = String(command || '');
  const functions = new Set([...source.matchAll(/(?:^|[\s;{])(?:function\s+([A-Za-z_][\w-]*)|([A-Za-z_][\w-]*)\s*\(\)\s*\{)/g)].map(match => (match[1] || match[2]).toLowerCase()));
  const ctx = { taskDir, cwd: cwd || workspaceDir || process.cwd(), functions };
  const found:ToolCategory[] = [];
  // Command substitutions ($( … ) and backticks) run commands of their own: each is judged, then stands in as a value.
  const text = substitutions(String(command || '').replace(/\s(?:-o|--output)\s+(?:\/dev\/null|nul)\b/gi, ' '), inner => found.push(categorizeCommand(inner, { taskDir, cwd })))
    // A heredoc body (python - <<'PY' … PY) is code or text, not statements: scan it as a script and keep it out of the split.
    .replace(/<<-?\s*(["']?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2\s*(?=\n|$)/g, (match, _quote, _tag, body) => { found.push(categorizeScript(body, ctx)); return match.slice(0, match.indexOf('\n')); });
  for (const statement of splitStatements(text)) {
    const cd = /^(?:cd|Set-Location|pushd|sl)\s+["']?([^"';|&]+?)["']?\s*$/i.exec(statement);
    if (cd) { const target = toNative(cd[1].trim()); ctx.cwd = path.isAbsolute(target) ? target : path.resolve(ctx.cwd, target); continue; }
    found.push(categorizeStatement(statement.replace(/^(?:for\s+\w+\s+in\s+[^;]*|do|then|else|done|fi)\s+/i, ''), ctx));
  }
  return worst(found);
}

/**
 * Replace each $( … ) with a placeholder, handing its inner command to `onInner`. Single quotes keep
 * their text literal. Backtick substitution is left alone: in PowerShell the backtick is the escape character.
 */
function substitutions(text:string, onInner:(command:string)=>void):string {
  let out = ''; let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") { out += ch; if (ch === "'") quote = null; continue; }
    if (ch === "'" && quote === null) { quote = "'"; out += ch; continue; }
    if (ch === '"') { quote = quote === '"' ? null : '"'; out += ch; continue; }
    if (ch === '$' && text[i + 1] === '(' && text[i + 2] !== '(') {
      let depth = 0; let j = i + 1;
      for (; j < text.length; j += 1) { if (text[j] === '(') depth += 1; else if (text[j] === ')') { depth -= 1; if (!depth) break; } }
      onInner(text.slice(i + 2, j)); out += '$SUB'; i = j; continue;
    }
    out += ch;
  }
  return out;
}

function parseMcpTool(toolName:unknown):{server:string;tool:string}|null {
  const match = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(String(toolName || ''));
  return match ? { server: match[1], tool: match[2] } : null;
}

function categorizeMcp({ server, tool }: {server:string;tool:string}, input:ToolInput = {}):ToolCategory {
  if (server === 'nervecenter') {
    if (tool === 'update_knowledge') return input.decision === 'skip' ? 'read' : 'knowledge_drafts';
    if (tool === 'set_ticket_status' && !['resolved', 'closed', 'cancelled'].includes(String(input.status || ''))) return 'default_write';
    // A tool missing from the list is a change, never a read.
    return TOOL_CATEGORIES[tool as keyof typeof TOOL_CATEGORIES] || 'default_write';
  }
  const name = tool.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  if (READ_VERBS.test(name.replace(/^[a-z]+_(?=(get|list|search|read|fetch|query|describe)_)/, ''))) {
    if (/execute_sql|run_sql|query|statement/.test(name)) { const sql = JSON.stringify(input); if (SQL_ACCESS.test(sql)) return 'privileged_access'; if (SQL_WRITE.test(sql)) return 'production_changes'; }
    return 'read';
  }
  if (/execute_sql|run_sql|sql_statement|execute_statement|run_query/.test(name)) { const sql = JSON.stringify(input); return SQL_ACCESS.test(sql) ? 'privileged_access' : SQL_WRITE.test(sql) ? 'production_changes' : 'read'; }
  if (/send|mail|email|notify_external/.test(name)) return 'email_send';
  if (/grant|revoke|permission|member|role|access|entitlement|group/.test(name)) return 'privileged_access';
  if (/run_now|run_job|start|stop|repair|cancel|restart|deploy|trigger|submit|delete_job|update_job|create_job|reset_job|execute|merge|push/.test(name)) return 'production_changes';
  if (/create_(issue|incident|ticket|task|change|problem)|transition|close|resolve|reopen|create_jira_issue/.test(name)) return 'ticket_writes';
  return 'default_write';
}

/** The category of any tool call. */
function categorizeTool(toolName:unknown, input:ToolInput = {}, { taskDir }:PolicyContext = {}):ToolCategory {
  const name = String(toolName || '');
  if (READ_TOOLS.has(name)) return 'read';
  const mcp = parseMcpTool(name); if (mcp) return categorizeMcp(mcp, input || {});
  if (FILE_WRITE_TOOLS.has(name)) { const target = String(input?.file_path || input?.path || input?.notebook_path || ''); return target ? categorizePath(target, { taskDir, cwd: taskDir ? path.dirname(path.dirname(taskDir)) : undefined }) : 'default_write'; }
  if (SHELL_TOOLS.has(name)) return categorizeCommand(input?.command, { taskDir });
  return 'default_write';
}

/* ------------------------------------------------------------------ resources */

// What a call touches, so a rule can be scoped to it the way an IAM statement is scoped to an ARN.
// Best effort by design: anything that cannot be read stays unknown, and `policy-rules.mjs` makes
// sure an unknown never widens permission.

/** The MCP server a tool came from, reduced to the system it talks to: `databricks-write` is Databricks. */
const SYSTEM_ALIASES:Array<[RegExp,string]> = [[/sharepoint/i, 'sharepoint'], [/databricks|azuredatabricks\.net|\/api\/2\.\d\/(?:jobs|sql|clusters|pipelines|unity-catalog)\//i, 'databricks'], [/snowflake/i, 'snowflake'], [/jira|atlassian|\/rest\/api\/\d\/issue/i, 'jira'], [/servicenow|service-now\.com|\/api\/now\//i, 'servicenow'], [/nervecenter/i, 'nervecenter'], [/mail|smtp|email/i, 'email']];
function systemOf(value:unknown):string { const text = String(value || ''); for (const [pattern, system] of SYSTEM_ALIASES) if (pattern.test(text)) return system; return ''; }

const TABLE_NAME = /\b(?:INSERT\s+(?:INTO|OVERWRITE)|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+TABLE|COPY\s+INTO|OPTIMIZE|VACUUM|DROP\s+(?:TABLE|VIEW)|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)|(?:GRANT|REVOKE)[\s\w,]+\s+ON\s+(?:TABLE\s+|VIEW\s+)?)\s*[`"']?([\w.]+)/gi;
const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const JIRA_KEY = /\b[A-Z][A-Z0-9_]+-\d+\b/g;

/** Every `type:name` pair a call mentions, read from its arguments and from any SQL or URL inside it. */
function objectsIn(text:string, input:ToolInput):ResourceObject[] {
  const found:ResourceObject[] = [];
  const add = (type:string, name:unknown) => { const value = String(name ?? '').trim(); if (value && !found.some(item => item.type === type && item.name === value)) found.push({ type, name: value }); };
  for (const key of ['job_id', 'jobId', 'job_name', 'jobName']) add('job', input?.[key]);
  for (const key of ['pipeline_id', 'pipelineId']) add('pipeline', input?.[key]);
  for (const key of ['cluster_id', 'clusterId']) add('cluster', input?.[key]);
  for (const key of ['warehouse_id', 'warehouseId']) add('warehouse', input?.[key]);
  for (const key of ['full_name', 'table_name', 'tableName', 'table']) add('table', input?.[key]);
  for (const key of ['ticketId', 'issueKey', 'issue_key', 'sys_id', 'sysId']) add('ticket', input?.[key]);
  for (const key of ['to', 'recipient', 'recipients', 'cc']) for (const value of [].concat((input?.[key] ?? []) as never)) add('recipient', value);
  for (const match of String(text).matchAll(TABLE_NAME)) add('table', match[1]);
  for (const match of String(text).matchAll(EMAIL_ADDRESS)) add('recipient', match[0]);
  for (const match of String(text).matchAll(JIRA_KEY)) add('ticket', match[0]);
  for (const match of String(text).matchAll(/--job-id[\s=]+(\d+)/gi)) add('job', match[1]);
  for (const match of String(text).matchAll(/["']?job_id["']?\s*[:=]\s*["']?(\d+)/gi)) add('job', match[1]);
  return found;
}

/**
 * Which named environment of a platform a call is aimed at: the one whose workspace or account
 * appears in the call. A platform with a single environment answers for it; anything else is
 * left unknown rather than guessed.
 */
function environmentOf(system:string, text:string, platforms:PolicyPlatform[]):string {
  const platform = (Array.isArray(platforms) ? platforms : []).find(item => systemOf(item?.type) === system || systemOf(item?.name) === system);
  const environments = Object.entries(platform?.environments || {});
  if (!environments.length) return '';
  for (const [name, environment] of environments) {
    const host = String(environment?.workspace || environment?.account || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (host && String(text).toLowerCase().includes(host.toLowerCase())) return name;
  }
  return environments.length === 1 ? environments[0][0] : '';
}

/** Everything a tool call touches, as `system:environment:type:name` strings for rules to match. */
export function resourcesFor(toolName:string, input:ToolInput = {}, { taskDir, platforms = [] }:PolicyOptions = {}):string[] {
  const name = String(toolName || '');
  const mcp = parseMcpTool(name);
  let system = mcp ? systemOf(mcp.server) : '';
  const command = SHELL_TOOLS.has(name) ? String(input?.command || '') : '';
  let serialized = ''; try { serialized = JSON.stringify(input ?? {}); } catch { serialized = ''; }
  const text = `${command} ${serialized}`;
  if (!system && command) system = systemOf(command) || (/\bsend_email\.py\b|\bsendmail\b|\bSend-MailMessage\b/i.test(command) ? 'email' : '');
  if (!system && FILE_WRITE_TOOLS.has(name)) system = 'workspace';
  const environment = system ? environmentOf(system, text, platforms) : '';
  const objects = objectsIn(text, input);
  if (FILE_WRITE_TOOLS.has(name)) {
    const target = String(input?.file_path || input?.path || input?.notebook_path || '');
    const workspaceDir = taskDir ? path.dirname(path.dirname(taskDir)) : null;
    const relative = workspaceDir && target ? path.relative(workspaceDir, path.resolve(workspaceDir, toNative(unquote(target)))).replaceAll('\\', '/') : unquote(target);
    if (relative) objects.push({ type: 'file', name: relative });
  }
  // A rule covering a whole platform still matches a known object, because a short pattern is
  // padded with wildcards. The bare resource is only for a call whose target could not be read:
  // emitting it next to a known object would make every scoped deny match it as well.
  if (!objects.length) return [resourceString({ system, environment })];
  return objects.map(object => resourceString({ system, environment, type: object.type, name: object.name }));
}

/** Merge the workspace policy with the defaults. Unknown values fall back to ask. */
function effectivePolicy(policy:PolicyShape = {}):Record<PolicyCategory,PolicyDecision> {
  const out:Record<PolicyCategory,PolicyDecision> = { ...POLICY_DEFAULTS };
  for (const key of POLICY_CATEGORIES) { const value = String(policy?.[key] ?? '').toLowerCase(); if (['allow', 'ask', 'deny'].includes(value)) out[key] = value as PolicyDecision; }
  return out;
}

export function classifyTool(toolName:string, input:ToolInput = {}, { taskDir, permission = 'policy', policy, platforms = [] }:PolicyOptions = {}) {
  const category = categorizeTool(toolName, input, { taskDir });
  if (category === 'read') return { verdict: 'allow', reason: 'read', category };
  if (category === 'task_files') return { verdict: 'allow', reason: 'task folder', category };
  if (permission === 'read-only') return { verdict: 'deny', reason: 'This task is read-only. Report what you would change instead of changing it.', category };
  if (permission === 'allow') return { verdict: 'allow', reason: 'task permits writes', category };
  if (permission === 'ask') return { verdict: 'ask', reason: 'this task asks before every change', category };
  // A scoped rule beats the category baseline; the most restrictive matching rule wins.
  const resources = resourcesFor(toolName, input, { taskDir, platforms });
  const matched = evaluatePolicyRules(normalizePolicyRules(policy?.rules, { categories: POLICY_CATEGORIES as unknown as string[] }).rules, { action: category, resources });
  const rule = matched ? matched.effect : effectivePolicy(policy)[category];
  const because = matched ? `rule: ${matched.effect} ${matched.action} on ${matched.resource}` : `policy: ${CATEGORY_LABELS[category]} is ${rule}`;
  if (rule === 'deny') return { verdict: 'deny', reason: `Workspace policy does not allow this (${CATEGORY_LABELS[category]}${matched?.description ? ` — ${matched.description}` : ''}). Explain what you would have done instead.`, category, rule: matched || null, resources };
  return { verdict: rule === 'allow' ? 'allow' : 'ask', reason: because, category, rule: matched || null, resources };
}

/* ------------------------------------------------------------------ describe */

const humanize = (value:unknown):string => String(value || '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
function firstIdentifier(input:ToolInput):string {
  for (const key of ['ticketId', 'issueKey', 'issue_key', 'key', 'id', 'ticket', 'number', 'sys_id', 'job_id', 'run_id', 'table', 'path', 'to', 'recipient', 'user', 'principal', 'name']) if (input && input[key] !== undefined && typeof input[key] !== 'object') return ` ${String(input[key]).slice(0, 80)}`;
  return '';
}

/** One line a person can read: what the agent wants to do. */
export function describeTool(toolName:string, input:ToolInput = {}):string {
  const mcp = parseMcpTool(toolName);
  if (mcp?.server === 'nervecenter') {
    const id = input?.ticketId ? ` ${input.ticketId}` : '';
    return ({ comment_on_ticket: `Comment on ticket${id}`, assign_ticket: `Assign ticket${id} to ${input?.assignee || 'someone'}`, update_ticket: `Update ticket${id}`, link_related_ticket: `Link ticket${id} to ${input?.relatedTicketId || 'another ticket'} (${humanize(input?.relation || 'related_to')})`, set_ticket_status: `Set ticket${id} to ${humanize(input?.status || '')}`, create_ticket: `Create ticket: ${String(input?.title || '').slice(0, 80)}`, update_knowledge: `Save a knowledge draft: ${String(input?.base || '')}${input?.path ? `/${String(input.path).slice(0, 120)}` : ''}` })[mcp.tool] || `NerveCenter · ${humanize(mcp.tool)}${firstIdentifier(input)}`;
  }
  if (mcp) return `${humanize(mcp.server)} · ${humanize(mcp.tool)}${firstIdentifier(input)}`;
  if (SHELL_TOOLS.has(toolName)) return `Run command: ${String(input.command || '').replace(/\s+/g, ' ').slice(0, 120)}`;
  if (FILE_WRITE_TOOLS.has(toolName)) return `${toolName === 'Write' ? 'Write' : 'Edit'} file ${String(input.file_path || input.path || input.notebook_path || '')}`;
  return `${humanize(toolName)}${firstIdentifier(input)}`;
}
