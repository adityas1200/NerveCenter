import { createHash } from 'node:crypto';
import { clean } from '../lib/util.mjs';

const DDL_MAX_BYTES = 100_000;
export const REQUIRED_MAPPINGS = ['checkId', 'status', 'executedAt'];
const OPTIONAL_MAPPINGS = ['checkName', 'dataset', 'field', 'rule', 'failedRows', 'message', 'severity', 'recommendedFix'];
export const MAPPING_KEYS = [...REQUIRED_MAPPINGS, ...OPTIONAL_MAPPINGS];

export const DEFAULT_MAPPING = {
  checkId: 'check_id', checkName: 'check_name', status: 'status', executedAt: 'executed_at',
  dataset: 'dataset', field: 'field_name', rule: 'rule_expression', failedRows: 'failed_rows',
  message: 'message', severity: 'severity', recommendedFix: 'recommended_fix',
};

const ALIASES = {
  checkId: ['check_id', 'checkid', 'check_result_id', 'dq_check_id', 'rule_id', 'result_id', 'id'],
  status: ['status', 'check_status', 'result_status', 'dq_result', 'outcome', 'result'],
  executedAt: ['executed_at', 'executedat', 'executed_on', 'run_at', 'checked_at', 'check_timestamp', 'event_time', 'created_at', 'timestamp'],
  checkName: ['check_name', 'checkname', 'rule_name', 'check', 'name'],
  dataset: ['dataset', 'dataset_name', 'source_table', 'table_name', 'object_name'],
  field: ['field_name', 'field', 'column_name', 'column'],
  rule: ['rule_expression', 'rule', 'expression', 'check_expression', 'condition'],
  failedRows: ['failed_rows', 'failed_count', 'failure_count', 'invalid_rows', 'row_count_failed', 'violations'],
  message: ['message', 'error_message', 'details', 'description', 'reason'],
  severity: ['severity', 'priority', 'level'],
  recommendedFix: ['recommended_fix', 'remediation', 'remediation_guidance', 'fix', 'recommendation'],
};

const CONSTRAINT_START = /^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|PARTITION\s+BY|CLUSTER\s+BY|WITH\s+TAG|ROW\s+ACCESS|MASKING\s+POLICY)\b/i;
const normalize = value => clean(value).replace(/^['"`\[]|['"`\]]$/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function byteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

function stripComments(ddl) {
  return String(ddl || '').replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitTopLevel(text) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index + 1] === quote) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === '`' || char === "'") { quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) { parts.push(text.slice(start, index).trim()); start = index + 1; }
  }
  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function findBody(ddl) {
  const open = ddl.indexOf('(');
  if (open < 0) return null;
  let depth = 0;
  let quote = null;
  for (let index = open; index < ddl.length; index += 1) {
    const char = ddl[index];
    if (quote) {
      if (char === quote && ddl[index + 1] === quote) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === '`' || char === "'") { quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return { start: open + 1, end: index };
    }
  }
  return null;
}

function parseIdentifierToken(text) {
  const match = String(text || '').trim().match(/^("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]])*\]|[A-Za-z0-9_$-]+)/);
  return match ? clean(match[1]).replace(/^\[|\]$/g, '').replace(/^"|"$/g, '').replace(/^`|`$/g, '') : '';
}

function parseObjectName(ddl) {
  const match = stripComments(ddl).match(/\b(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+|OR\s+REPLACE\s+)?(["`\[\]A-Za-z0-9_$.-]+)/i);
  if (!match) return null;
  const parts = match[1].split('.').map(parseIdentifierToken).filter(Boolean);
  return { catalog: parts.length > 2 ? parts.at(-3) : '', schema: parts.length > 1 ? parts.at(-2) : '', table: parts.at(-1) || '' };
}

function parseColumn(definition) {
  const text = clean(definition);
  if (!text || CONSTRAINT_START.test(text)) return null;
  const token = text.match(/^("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]])*\]|[A-Za-z0-9_$-]+)/);
  const name = parseIdentifierToken(token?.[1] || '');
  if (!name) return null;
  const remainder = text.slice(token[0].length).trim();
  if (!remainder || /^AS\s*\(/i.test(remainder)) return null;
  const typeMatch = remainder.match(/^([A-Za-z][A-Za-z0-9_]*(?:\s*\([^)]*\))?)/);
  const type = clean(typeMatch?.[1] || '');
  if (!type) return null;
  return { name, normalizedName: normalize(name), type, nullable: !/\bNOT\s+NULL\b/i.test(remainder), comment: (remainder.match(/\bCOMMENT\s+(['"`].*?['"`])/i)?.[1] || '').replace(/^['"`]|['"`]$/g, '') || null };
}

function hashDdl(ddl) {
  return createHash('sha256').update(String(ddl || ''), 'utf8').digest('hex');
}

function parseDdl(ddl, expected = {}) {
  const text = String(ddl || '').trim();
  if (!text) throw new Error('DDL is required');
  if (byteLength(text) > DDL_MAX_BYTES) throw new Error(`DDL must be ${DDL_MAX_BYTES.toLocaleString()} bytes or smaller`);
  if (!/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW)\b/i.test(text)) throw new Error('Paste one CREATE TABLE or CREATE VIEW statement');
  const body = findBody(stripComments(text));
  if (!body) throw new Error('The DDL does not contain a readable column definition list');
  const object = parseObjectName(text);
  const columns = splitTopLevel(stripComments(text).slice(body.start, body.end)).map(parseColumn).filter(Boolean);
  if (!columns.length) throw new Error('No table columns were found in the DDL');
  const duplicates = columns.map(column => column.normalizedName).filter((name, index, names) => names.indexOf(name) !== index);
  const issues = [...new Set(duplicates)].map(name => `The DDL contains duplicate column name ${name}`);
  const expectedTable = clean(expected.resultTable).toLowerCase();
  if (object?.table && expectedTable && object.table.toLowerCase() !== expectedTable) issues.push(`DDL table ${object.table} does not match ${expected.resultTable}`);
  if (object?.schema && clean(expected.schema) && object.schema.toLowerCase() !== clean(expected.schema).toLowerCase()) issues.push(`DDL schema ${object.schema} does not match ${expected.schema}`);
  return { object, columns, issues, ddlHash: hashDdl(text) };
}

function candidatesFor(key, columns) {
  const aliases = new Set((ALIASES[key] || []).map(normalize));
  return columns.filter(column => aliases.has(column.normalizedName));
}

function deriveMapping(columns) {
  const mapping = {};
  const candidates = {};
  const issues = [];
  for (const key of MAPPING_KEYS) {
    const matches = candidatesFor(key, columns);
    candidates[key] = matches.map(column => column.name);
    if (matches.length === 1) mapping[key] = matches[0].name;
    if (matches.length > 1) issues.push(`${key} has more than one possible column: ${matches.map(column => column.name).join(', ')}`);
    if (!matches.length && REQUIRED_MAPPINGS.includes(key)) issues.push(`${key} could not be found in the DDL`);
  }
  return { mapping, candidates, issues };
}

function validType(key, column) {
  if (!column) return false;
  if (key === 'executedAt') return /date|time|timestamp/i.test(column.type);
  if (key === 'failedRows') return /int|number|numeric|decimal|float|double|real/i.test(column.type);
  return true;
}

export function validateMapping(mapping = {}, columns = []) {
  const byName = new Map(columns.map(column => [column.normalizedName, column]));
  const cleaned = {};
  const issues = [];
  for (const key of MAPPING_KEYS) {
    const value = clean(mapping[key]);
    if (!value) continue;
    const column = byName.get(normalize(value));
    if (!column) { issues.push(`${key} points to a column that is not in the DDL: ${value}`); continue; }
    if (!validType(key, column)) issues.push(`${key} points to ${column.name}, which has an unexpected type ${column.type}`);
    cleaned[key] = column.name;
  }
  for (const key of REQUIRED_MAPPINGS) if (!cleaned[key]) issues.push(`${key} is required`);
  return { mapping: cleaned, issues };
}

export function analyzeDdl(ddl, expected = {}) {
  const parsed = parseDdl(ddl, expected);
  const derived = deriveMapping(parsed.columns);
  const checked = validateMapping(derived.mapping, parsed.columns);
  return {
    ...parsed,
    mapping: checked.mapping,
    candidates: derived.candidates,
    issues: [...parsed.issues, ...derived.issues.filter(issue => !checked.issues.includes(issue)), ...checked.issues],
    deterministic: derived,
  };
}

export const mappingAliases = ALIASES;
