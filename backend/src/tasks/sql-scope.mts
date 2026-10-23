// What a SQL statement writes, read from its tokens (SPEC-tasks-13 FR-3, FR-5, FR-7). The fix tools write
// without asking only inside the sandbox schema, so this is deny by default: one statement, a fixed list of
// shapes, every write target named in full. Strings and comments are never read as names.

export type SqlProvider = 'databricks'|'snowflake';
type Token = { type: 'word'|'quoted'|'string'|'comment'|'space'|'punct'; text: string; start: number; end: number };
export type SqlShape = { kind: 'select' } | { kind: 'write'; verb: string; target: string; others: string[] };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function tokenize(sql: string, provider: SqlProvider): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  const push = (type: Token['type'], end: number) => { tokens.push({ type, text: sql.slice(at, end), start: at, end }); at = end; };
  while (at < sql.length) {
    const ch = sql[at]; const next = sql[at + 1];
    if (ch === '-' && next === '-') { const stop = sql.indexOf('\n', at); push('comment', stop < 0 ? sql.length : stop); continue; }
    if (ch === '/' && next === '*') { const stop = sql.indexOf('*/', at + 2); if (stop < 0) throw new Error('The statement has a comment that is never closed'); push('comment', stop + 2); continue; }
    // Databricks reads "…" as a string; Snowflake as a name.
    if (ch === "'" || (ch === '"' && provider === 'databricks')) {
      let end = at + 1;
      while (end < sql.length) { if (sql[end] === '\\') { end += 2; continue; } if (sql[end] === ch) { if (sql[end + 1] === ch) { end += 2; continue; } break; } end += 1; }
      if (end >= sql.length) throw new Error('The statement has a quote that is never closed');
      push('string', end + 1); continue;
    }
    if (ch === '`' || ch === '"') { const stop = sql.indexOf(ch, at + 1); if (stop < 0) throw new Error('The statement has a quoted name that is never closed'); push('quoted', stop + 1); continue; }
    if (/\s/.test(ch)) { let end = at; while (end < sql.length && /\s/.test(sql[end])) end += 1; push('space', end); continue; }
    if (/[A-Za-z_]/.test(ch)) { let end = at; while (end < sql.length && /[\w$]/.test(sql[end])) end += 1; push('word', end); continue; }
    push('punct', at + 1);
  }
  return tokens;
}

const code = (tokens: Token[]) => tokens.filter(token => token.type !== 'space' && token.type !== 'comment');
const partOf = (token: Token) => (token.type === 'quoted' ? token.text.slice(1, -1) : token.text).toLowerCase();

/** Name references in reading order: each is one, two or three parts joined by dots, with where it sits in the text. */
function names(tokens: Token[]): Array<{ parts: string[]; start: number; end: number; index: number }> {
  const list = code(tokens);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].type !== 'word' && list[i].type !== 'quoted') continue;
    // A part that follows a dot belongs to the name before it.
    if (i > 0 && list[i - 1].text === '.') continue;
    const parts = [partOf(list[i])]; let last = i;
    while (parts.length < 4 && list[last + 1]?.text === '.' && (list[last + 2]?.type === 'word' || list[last + 2]?.type === 'quoted') && list[last + 1].start === list[last].end && list[last + 2].start === list[last + 1].end) { parts.push(partOf(list[last + 2])); last += 2; }
    out.push({ parts, start: list[i].start, end: list[last].end, index: i });
    i = last;
  }
  return out;
}

/** A full name a tool was given ("cat.schema.table"), checked and lower-cased; throws a sentence the agent can fix. */
export function fullName(value: unknown, what = 'table', parts = 3): string {
  const text = String(value || '').trim().replace(/[`"]/g, '');
  const split = text.split('.');
  if (split.length !== parts || !split.every(part => IDENT.test(part))) throw new Error(`Give the ${what} as ${parts === 3 ? 'catalog.schema.table (database.schema.table on Snowflake)' : 'catalog.schema (database.schema on Snowflake)'} using letters, digits and underscores: "${text}" is not one`);
  return split.join('.').toLowerCase();
}

export const inSchema = (name: string, schema: string) => name.split('.').length === 3 && name.split('.').slice(0, 2).join('.') === schema.toLowerCase();

const sameTable = (parts: string[], target: string) => { const full = target.split('.'); return parts.join('.') === target || (parts.length === 2 && parts.join('.') === full.slice(1).join('.')); };

/** Whether a statement reads or writes `target` (by full name or schema.table). */
export function mentions(sql: string, target: string, provider: SqlProvider = 'databricks'): boolean {
  try { return names(tokenize(sql, provider)).some(name => sameTable(name.parts, target)); } catch { return false; }
}

/** `sql` with every reference to `from` (full or schema.table) replaced by `to`, outside strings and comments. */
export function swapTable(sql: string, from: string, to: string, provider: SqlProvider = 'databricks'): { sql: string; count: number } {
  const found = names(tokenize(sql, provider)).filter(name => sameTable(name.parts, from));
  let out = sql;
  for (const name of [...found].reverse()) out = `${out.slice(0, name.start)}${to}${out.slice(name.end)}`;
  return { sql: out, count: found.length };
}

const WRITE_VERBS = new Set(['insert', 'update', 'delete', 'merge', 'create', 'alter', 'drop', 'truncate']);

/** What one statement does: a SELECT, or a write with its target. Anything outside the allowed shapes throws. */
export function shapeOf(statement: string, provider: SqlProvider = 'databricks'): SqlShape {
  const sql = String(statement || '').trim().replace(/;\s*$/, '');
  if (!sql) throw new Error('The statement is empty');
  const tokens = tokenize(sql, provider);
  const list = code(tokens);
  if (list.some(token => token.text === ';')) throw new Error('Run one statement at a time');
  const words = list.filter(token => token.type === 'word').map(token => token.text.toLowerCase());
  if (words.includes('grant') || words.includes('revoke')) throw new Error('Access changes (GRANT, REVOKE) are not allowed here');
  const word = (i: number) => (list[i]?.type === 'word' ? list[i].text.toLowerCase() : '');
  const first = word(0);
  if (first === 'select') return { kind: 'select' };
  // Spark accepts WITH … INSERT; a write hidden behind a CTE would dodge the target check.
  if (first === 'with') {
    if (words.some(item => WRITE_VERBS.has(item))) throw new Error('A statement that starts with WITH may only read; put the write first');
    return { kind: 'select' };
  }
  const refs = names(tokens);
  const nameAt = (i: number) => { const ref = refs.find(item => item.index === i); if (!ref) throw new Error(`Name the table after ${list.slice(0, i).map(token => token.text.toUpperCase()).join(' ')}`); return ref; };
  let i = 1; let verb = first;
  if (first === 'insert') {
    const mode = word(1); if (mode !== 'into' && mode !== 'overwrite') throw new Error('Use INSERT INTO or INSERT OVERWRITE with one target table');
    i = 2; if (word(i) === 'table') i += 1; verb = `insert ${mode}`;
  } else if (first === 'update') i = 1;
  else if (first === 'delete') { if (word(1) !== 'from') throw new Error('Use DELETE FROM <table>'); i = 2; verb = 'delete from'; }
  else if (first === 'merge') { if (word(1) !== 'into') throw new Error('Use MERGE INTO <table>'); i = 2; verb = 'merge into'; }
  else if (first === 'create') {
    let replace = false; if (word(1) === 'or' && word(2) === 'replace') { replace = true; i = 3; }
    const kind = word(i); if (kind !== 'table' && kind !== 'view') throw new Error('Only CREATE TABLE and CREATE VIEW are allowed');
    i += 1; if (word(i) === 'if' && word(i + 1) === 'not' && word(i + 2) === 'exists') i += 3;
    verb = `create${replace ? ' or replace' : ''} ${kind}`;
  } else if (first === 'alter' || first === 'drop') {
    const kind = word(1); if (kind !== 'table' && kind !== 'view') throw new Error(`Only ${first.toUpperCase()} TABLE and ${first.toUpperCase()} VIEW are allowed`);
    i = 2; if (first === 'drop' && word(2) === 'if' && word(3) === 'exists') i = 4;
    verb = `${first} ${kind}`;
  } else if (first === 'truncate') { if (word(1) !== 'table') throw new Error('Use TRUNCATE TABLE <table>'); i = 2; verb = 'truncate table'; }
  else throw new Error(`${first ? first.toUpperCase() : 'This'} statements are not allowed here; use SELECT, INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER, DROP or TRUNCATE`);
  const target = nameAt(i);
  if (target.parts.length !== 3) throw new Error(`Name the table in full (catalog.schema.table): "${sql.slice(target.start, target.end)}"`);
  // A rename moves the table: the new name must be checked as well.
  const others: string[] = [];
  if (first === 'alter') {
    const renameAt = list.findIndex((token, at) => at > target.index && token.type === 'word' && token.text.toLowerCase() === 'rename');
    if (renameAt >= 0) { const ref = refs.find(item => item.index > renameAt && list[item.index - 1]?.text.toLowerCase() === 'to'); if (!ref || ref.parts.length !== 3) throw new Error('Name the new table in full after RENAME TO'); others.push(ref.parts.join('.')); }
  }
  return { kind: 'write', verb, target: target.parts.join('.'), others };
}
