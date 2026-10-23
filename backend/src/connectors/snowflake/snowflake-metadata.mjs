import { SnowflakeService } from './snowflake-service.mjs';

/**
 * Read-only Snowflake metadata: task/pipe/dynamic-table inventories, task run
 * history, table and column definitions, object DDL, and dependency lineage.
 *
 * Everything here goes through SnowflakeService.queryRows, so every statement is
 * bound by the same single-SELECT read-only guard used for warehouse queries.
 * There is no second, weaker path into the account.
 *
 * Snowflake exposes the same metadata at two privilege levels and neither is
 * guaranteed: SNOWFLAKE.ACCOUNT_USAGE needs an explicit grant and lags by up to
 * ~3 hours, while <db>.INFORMATION_SCHEMA needs only USAGE but is scoped to one
 * database and keeps far less history. Rather than pick one and fail on accounts
 * that did not grant it, each inventory tries ACCOUNT_USAGE, falls back to
 * INFORMATION_SCHEMA, and reports per-source status so the UI can say *why*
 * something is empty instead of showing a blank list.
 */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** Snowflake identifiers are interpolated, never bound, so they must be validated. */
function ident(value, label = 'identifier') {
  const text = String(value ?? '').trim();
  if (!IDENTIFIER.test(text)) throw new Error(`Snowflake ${label} is invalid: ${text || '(empty)'}`);
  return text.toUpperCase();
}

/** Single quotes are the only escape that matters inside a Snowflake string literal. */
function lit(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

const iso = value => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const num = value => (value === null || value === undefined || value === '' ? null : Number(value));

const TASK_STATUS = { SUCCEEDED: 'healthy', FAILED: 'failed', FAILED_AND_AUTO_SUSPENDED: 'failed', CANCELLED: 'failed', SKIPPED: 'skipped', EXECUTING: 'running', SCHEDULED: 'running' };
const taskStatus = state => TASK_STATUS[String(state || '').toUpperCase()] || 'status_not_reported';

const OBJECT_KIND = { 'BASE TABLE': 'table', TABLE: 'table', VIEW: 'view', 'MATERIALIZED VIEW': 'materialized_view', 'EXTERNAL TABLE': 'external_table', 'DYNAMIC TABLE': 'dynamic_table' };
const objectKind = type => OBJECT_KIND[String(type || '').toUpperCase()] || String(type || 'table').toLowerCase().replace(/\s+/g, '_');

/** GET_DDL needs the object domain, which differs from the INFORMATION_SCHEMA type. */
const DDL_DOMAIN = { table: 'TABLE', view: 'VIEW', materialized_view: 'VIEW', external_table: 'TABLE', dynamic_table: 'DYNAMIC_TABLE', task: 'TASK', pipe: 'PIPE' };

const qualify = (database, schema, name) => [database, schema, name].filter(Boolean).join('.');

/** A source that is missing or ungranted must degrade to a reason, never a thrown call. */
function unavailable(error) {
  const message = String(error?.message || error || 'unavailable');
  // These three are the failures an operator will actually hit, and the raw
  // Snowflake text does not say what to change. Everything else passes through.
  if (/no active warehouse|warehouse.*not (selected|specified)/i.test(message)) {
    return 'No warehouse is selected. Set a warehouse on the Snowflake connection; metadata views still need compute to run.';
  }
  if (/invalid identifier|unexpected .* column/i.test(message)) {
    return `This Snowflake metadata view does not expose one of the expected columns (${message.slice(0, 120)}).`;
  }
  if (/does not exist|not authorized|insufficient privileges|unauthorized/i.test(message)) {
    return 'This role cannot read that metadata view. Grant IMPORTED PRIVILEGES on SNOWFLAKE, or the object does not exist in this account.';
  }
  return message.slice(0, 300);
}

export class SnowflakeMetadataService {
  constructor({ service, connection, database, schema, accountUsage = true } = {}) {
    this.service = service || new SnowflakeService({ ...(connection?.config || {}), ...(connection?.credentials || {}) });
    this.database = database || connection?.config?.database || '';
    this.schema = schema || connection?.config?.schema || '';
    this.accountUsage = accountUsage !== false;
    this.retriggered = new Map();
  }

  async #rows(statement) {
    return this.service.queryRows({ statement });
  }

  /** Runs a source and converts a failure into a reported gap rather than an exception. */
  async #source(id, statement, map) {
    return this.#sourceRead(id, () => this.#rows(statement), map);
  }

  async #sourceRead(id, read, map) {
    try {
      const rows = await read();
      return { id, status: 'ok', count: rows.length, items: rows.map(map) };
    } catch (error) {
      return { id, status: 'unavailable', count: 0, items: [], reason: unavailable(error) };
    }
  }

  #requireDatabase() {
    if (!this.database) throw new Error('Set a database on the Snowflake connection before browsing metadata');
    return ident(this.database, 'database');
  }

  /** Tasks, pipes, and dynamic tables are Snowflake's equivalent of a pipeline. */
  async listPipelines({ limit = 200, includeHealth = true } = {}) {
    const database = this.#requireDatabase();
    const target = Math.max(1, Math.min(5000, Number(limit) || 200));
    const sources = [];

    const tasks = await this.#sourceRead('show.tasks', () => this.service.listVisibleTasks({ database, limit: target }), row => ({
      pipelineId: `task:${qualify(row.database_name, row.schema_name, row.name)}`,
      name: row.name,
      platform: 'snowflake',
      kind: 'task',
      database: row.database_name,
      schema: row.schema_name,
      owner: row.owner || null,
      summary: row.comment || '',
      schedule: row.schedule || (row.predecessors ? 'after predecessor task' : null),
      condition: row.condition || null,
      definition: row.definition || null,
      predecessors: parseList(row.predecessors),
      enabled: String(row.state || '').toLowerCase() !== 'suspended',
      status: 'no_runs',
      lastRunId: null, lastRunAt: null, lastSuccessAt: null,
    }));
    tasks.note = `Tasks visible to the configured Snowflake role in database ${database}.`;
    tasks.database = database;
    tasks.accessScope = 'current_role';
    sources.push(tasks);

    if (database) {
      sources.push(await this.#source('information_schema.pipes', `
        SELECT PIPE_CATALOG, PIPE_SCHEMA, PIPE_NAME, PIPE_OWNER, DEFINITION, IS_AUTOINGEST_ENABLED, COMMENT, LAST_ALTERED
        FROM ${database}.INFORMATION_SCHEMA.PIPES
        ORDER BY PIPE_SCHEMA, PIPE_NAME
        LIMIT ${target}`, row => ({
        pipelineId: `pipe:${qualify(row.pipe_catalog, row.pipe_schema, row.pipe_name)}`,
        name: row.pipe_name,
        platform: 'snowflake',
        kind: 'pipe',
        database: row.pipe_catalog,
        schema: row.pipe_schema,
        owner: row.pipe_owner || null,
        summary: row.comment || '',
        schedule: String(row.is_autoingest_enabled).toUpperCase() === 'YES' ? 'auto-ingest on new files' : 'manual REST ingest',
        definition: row.definition || null,
        predecessors: [],
        enabled: true,
        status: 'no_runs',
        lastRunId: null, lastRunAt: iso(row.last_altered), lastSuccessAt: null,
      })));

      sources.push(await this.#source('information_schema.dynamic_tables', `
        SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_OWNER, COMMENT, LAST_ALTERED
        FROM ${database}.INFORMATION_SCHEMA.TABLES
        WHERE IS_DYNAMIC = 'YES'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
        LIMIT ${target}`, row => ({
        pipelineId: `dynamic_table:${qualify(row.table_catalog, row.table_schema, row.table_name)}`,
        name: row.table_name,
        platform: 'snowflake',
        kind: 'dynamic_table',
        database: row.table_catalog,
        schema: row.table_schema,
        owner: row.table_owner || null,
        summary: row.comment || '',
        schedule: 'target lag refresh',
        definition: null,
        predecessors: [],
        enabled: true,
        status: 'no_runs',
        lastRunId: null, lastRunAt: iso(row.last_altered), lastSuccessAt: null,
      })));
    } else {
      sources.push({ id: 'information_schema', status: 'unavailable', count: 0, items: [], reason: 'Set a database on the Snowflake connection to list pipes and dynamic tables' });
    }

    const pipelines = sources.flatMap(source => source.items).slice(0, target);
    if (includeHealth) await this.#attachTaskHealth(pipelines);
    return { pipelines, sources: sources.map(({ items, ...rest }) => rest) };
  }

  /** Joins the most recent run of each task onto the inventory in one history read. */
  async #attachTaskHealth(pipelines) {
    const tasks = pipelines.filter(item => item.kind === 'task' && item.status === 'no_runs');
    if (!tasks.length || !this.database) return;
    try {
      const runs = await this.listRuns({ limit: 10000 });
      const latest = new Map();
      const latestSuccess = new Map();
      for (const run of runs) if (!latest.has(run.pipelineId)) latest.set(run.pipelineId, run);
      for (const run of runs) if (run.status === 'healthy' && !latestSuccess.has(run.pipelineId)) latestSuccess.set(run.pipelineId, run);
      for (const task of tasks) {
        const run = latest.get(task.pipelineId);
        if (!run) continue;
        task.status = run.status;
        task.lastRunId = run.runId;
        task.lastRunAt = run.startTime;
        task.lastSuccessAt = latestSuccess.get(task.pipelineId)?.endTime || null;
      }
    } catch { /* history is best-effort; the inventory is still correct without it */ }
  }

  async getPipeline({ pipelineId }) {
    if (!pipelineId) throw new Error('pipelineId is required');
    const { pipelines } = await this.listPipelines({ limit: 1000 });
    const found = pipelines.find(item => item.pipelineId === String(pipelineId));
    if (!found) throw new Error(`Snowflake pipeline not found: ${pipelineId}`);
    const [kind, qualified] = splitPipelineId(pipelineId);
    const ddl = await this.getDdl({ objectId: qualified, kind }).catch(() => null);
    return { ...found, ddl: ddl?.ddl || found.definition || null };
  }

  /** Snowflake's run feed is task history; pipes and dynamic tables have no run rows. */
  async listRuns({ pipelineId, limit = 50, startTimeFrom } = {}) {
    const database = this.#requireDatabase();
    const target = Math.max(1, Math.min(10000, Number(limit) || 50));
    const arguments_ = [`SCHEDULED_TIME_RANGE_END => CURRENT_TIMESTAMP()`, `RESULT_LIMIT => ${target}`, `DATABASE_NAME => ${lit(database)}`];
    const requestedStart = startTimeFrom === undefined ? null : new Date(startTimeFrom);
    if (requestedStart && !Number.isNaN(requestedStart.getTime())) {
      // INFORMATION_SCHEMA.TASK_HISTORY is limited to seven days. Passing the
      // actual UI boundary prevents newer scheduled/executing rows from crowding
      // completed rows out before the table function applies its result limit.
      const oldestSupported = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const effectiveStart = new Date(Math.max(requestedStart.getTime(), oldestSupported)).toISOString();
      arguments_.unshift(`SCHEDULED_TIME_RANGE_START => TO_TIMESTAMP_LTZ(${lit(effectiveStart)})`);
    }
    if (pipelineId) {
      const [kind, qualified] = splitPipelineId(pipelineId);
      if (kind !== 'task') return [];
      const parts = qualified.split('.');
      if (parts.length !== 3) throw new Error(`Snowflake task pipeline ID must be fully qualified: ${pipelineId}`);
      const taskDatabase = ident(parts[0], 'database');
      if (taskDatabase !== database) throw new Error(`Snowflake task ${pipelineId} is outside configured database ${database}`);
      arguments_.push(`SCHEMA_NAME => ${lit(ident(parts[1], 'schema'))}`, `TASK_NAME => ${lit(ident(parts[2], 'task name'))}`);
    }
    const rows = await this.#rows(`
      SELECT NAME, DATABASE_NAME, SCHEMA_NAME, GRAPH_RUN_GROUP_ID, RUN_ID, STATE, SCHEDULED_TIME, QUERY_START_TIME, COMPLETED_TIME, ERROR_CODE, ERROR_MESSAGE, ATTEMPT_NUMBER, QUERY_ID
      FROM TABLE(${database}.INFORMATION_SCHEMA.TASK_HISTORY(${arguments_.join(', ')}))
      WHERE SCHEDULED_TIME <= CURRENT_TIMESTAMP()`);
    return rows.map(row => {
      const start = iso(row.query_start_time || row.scheduled_time);
      const end = iso(row.completed_time);
      const attempt = num(row.attempt_number);
      const baseRunId = String(row.graph_run_group_id || row.run_id || row.query_id || `${row.name}-${row.scheduled_time}`);
      return {
        runId: attempt && attempt > 1 ? `${baseRunId}:${attempt}` : baseRunId,
        pipelineId: `task:${qualify(row.database_name, row.schema_name, row.name)}`,
        name: row.name,
        platform: 'snowflake',
        status: taskStatus(row.state),
        rawState: row.state || null,
        startTime: start,
        endTime: end,
        durationMs: start && end ? new Date(end).getTime() - new Date(start).getTime() : null,
        attempt,
        queryId: row.query_id || null,
        failureSummary: row.error_message ? `${row.error_code || 'error'}: ${row.error_message}` : null,
      };
    }).sort((left, right) => String(right.startTime || '').localeCompare(String(left.startTime || '')));
  }

  async getRun({ runId, pipelineId }) {
    if (!runId) throw new Error('runId is required');
    const runs = await this.listRuns({ pipelineId, limit: 200 });
    const found = runs.find(item => String(item.runId) === String(runId));
    if (!found) throw new Error(`Snowflake task run not found: ${runId}`);
    return found;
  }

  async collectRcaEvidence({ ticketId, pipelineId, runId }) {
    const [pipeline, run, recentRuns] = await Promise.all([
      this.getPipeline({ pipelineId }),
      this.getRun({ pipelineId, runId }),
      this.listRuns({ pipelineId, limit: 20 }),
    ]);
    const lineage = await this.getLineage({ objectId: pipelineId, depth: 2 }).catch(error => ({ root: pipelineId, nodes: [], edges: [], source: null, reason: String(error?.message || error) }));
    const definition = pipeline.ddl || pipeline.definition || null;
    return {
      ticketId,
      pipelineId,
      runId,
      platform: 'snowflake',
      pipeline,
      runDetails: run,
      logs: { error: run.failureSummary || null, queryId: run.queryId || null, rawState: run.rawState || null },
      recentRuns,
      lineage,
      sourceCode: definition ? { available: true, kind: 'snowflake_task_ddl', path: pipelineId, content: definition, versionReference: run.queryId || null, versionWarning: 'Snowflake GET_DDL returns the current task definition, which may differ from the definition used by an older run.' } : { available: false, kind: 'snowflake_task_ddl', path: pipelineId, content: null, versionReference: null, versionWarning: 'The configured Snowflake role could not read the task definition.' },
      evidenceGaps: [definition ? null : 'Task DDL is unavailable to the configured role.', lineage.reason || null].filter(Boolean),
    };
  }

  async retriggerPipeline({ pipelineId, reason = '', idempotencyKey } = {}) {
    if (!pipelineId) throw new Error('pipelineId is required');
    const key = String(idempotencyKey || '').trim();
    if (key && this.retriggered.has(key)) return this.retriggered.get(key);
    const [kind, qualified] = splitPipelineId(pipelineId);
    if (kind !== 'task') throw new Error(`Snowflake ${kind} pipelines do not support manual task execution`);
    const parts = qualified.split('.');
    if (parts.length !== 3) throw new Error(`Snowflake task pipeline ID must be fully qualified: ${pipelineId}`);
    const database = this.#requireDatabase();
    if (ident(parts[0], 'database') !== database) throw new Error(`Snowflake task ${pipelineId} is outside configured database ${database}`);
    const execution = await this.service.executeTask({ database: parts[0], schema: parts[1], name: parts[2] });
    const result = { ...execution, pipelineId: String(pipelineId), reason: String(reason || ''), requestedAt: new Date().toISOString(), idempotencyKey: key || null };
    if (key) this.retriggered.set(key, result);
    return result;
  }

  async getRemediationResult({ pipelineId, requestedAt } = {}) {
    if (!pipelineId) throw new Error('pipelineId is required');
    const runs = await this.listRuns({ pipelineId, limit: 20 });
    const threshold = requestedAt ? new Date(requestedAt).getTime() : 0;
    const observed = runs.find(run => !threshold || !run.startTime || new Date(run.startTime).getTime() >= threshold);
    if (!observed) return { pending: true, passed: false, healthy: false, runIds: [], evidence: [], reason: 'Waiting for Snowflake task history to report the requested execution.' };
    if (observed.status === 'running' || observed.status === 'status_not_reported') return { pending: true, passed: false, healthy: false, runIds: [observed.runId], evidence: [observed] };
    return { pending: false, passed: observed.status === 'healthy', healthy: observed.status === 'healthy', runIds: [observed.runId], evidence: [observed], reason: observed.status === 'healthy' ? 'The retriggered Snowflake task succeeded.' : `The retriggered Snowflake task reached ${observed.status}.` };
  }

  /** Table inventory for the connection's database, optionally filtered. */
  async listTables({ schema = this.schema, search = '', limit = 500 } = {}) {
    const database = this.#requireDatabase();
    const target = Math.max(1, Math.min(2000, Number(limit) || 500));
    const filters = [`TABLE_SCHEMA <> 'INFORMATION_SCHEMA'`];
    if (schema) filters.push(`TABLE_SCHEMA = ${lit(ident(schema, 'schema'))}`);
    if (search) filters.push(`(TABLE_NAME ILIKE ${lit(`%${search}%`)} OR TABLE_SCHEMA ILIKE ${lit(`%${search}%`)})`);
    const rows = await this.#rows(`
      SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, ROW_COUNT, BYTES, TABLE_OWNER, COMMENT, CREATED, LAST_ALTERED
      FROM ${database}.INFORMATION_SCHEMA.TABLES
      WHERE ${filters.join(' AND ')}
      ORDER BY TABLE_SCHEMA, TABLE_NAME
      LIMIT ${target}`);
    return rows.map(row => ({
      id: qualify(row.table_catalog, row.table_schema, row.table_name),
      platform: 'snowflake',
      database: row.table_catalog,
      schema: row.table_schema,
      name: row.table_name,
      kind: objectKind(row.table_type),
      rowCount: num(row.row_count),
      bytes: num(row.bytes),
      owner: row.table_owner || null,
      comment: row.comment || null,
      createdAt: iso(row.created),
      lastAlteredAt: iso(row.last_altered),
    }));
  }

  /** One table with its columns, its defining code, and its immediate lineage. */
  async getTable({ objectId, id } = {}) {
    const target = String(objectId || id || '');
    const { database, schema, name } = splitObjectId(target, this.database, this.schema);
    const databaseIdent = ident(database, 'database');
    const [table] = await this.#rows(`
      SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, ROW_COUNT, BYTES, TABLE_OWNER, COMMENT, CREATED, LAST_ALTERED, CLUSTERING_KEY
      FROM ${databaseIdent}.INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ${lit(schema)} AND TABLE_NAME = ${lit(name)}
      LIMIT 1`);
    if (!table) throw new Error(`Snowflake table not found: ${qualify(database, schema, name)}`);
    const kind = objectKind(table.table_type);

    const columns = (await this.#rows(`
      SELECT COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COMMENT, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
      FROM ${databaseIdent}.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ${lit(schema)} AND TABLE_NAME = ${lit(name)}
      ORDER BY ORDINAL_POSITION`)).map(row => ({
      name: row.column_name,
      position: num(row.ordinal_position),
      type: formatType(row),
      nullable: String(row.is_nullable).toUpperCase() === 'YES',
      default: row.column_default ?? null,
      comment: row.comment || null,
    }));

    const ddl = await this.getDdl({ objectId: qualify(database, schema, name), kind }).catch(error => ({ ddl: null, reason: unavailable(error) }));
    const lineage = await this.getLineage({ objectId: qualify(database, schema, name), depth: 1 }).catch(() => null);

    return {
      id: qualify(database, schema, name),
      platform: 'snowflake',
      database, schema, name, kind,
      rowCount: num(table.row_count),
      bytes: num(table.bytes),
      owner: table.table_owner || null,
      comment: table.comment || null,
      clusteringKey: table.clustering_key || null,
      createdAt: iso(table.created),
      lastAlteredAt: iso(table.last_altered),
      columns,
      ddl: ddl?.ddl || null,
      ddlUnavailableReason: ddl?.reason || null,
      upstream: lineage?.edges?.filter(edge => edge.to === qualify(database, schema, name)).map(edge => edge.from) ?? [],
      downstream: lineage?.edges?.filter(edge => edge.from === qualify(database, schema, name)).map(edge => edge.to) ?? [],
      lineageUnavailableReason: lineage?.reason || null,
    };
  }

  /** GET_DDL returns the real source of the object, which is what a reviewer wants to read. */
  async getDdl({ objectId, kind = 'table' }) {
    const { database, schema, name } = splitObjectId(objectId, this.database, this.schema);
    const domain = DDL_DOMAIN[kind] || 'TABLE';
    const qualified = `${ident(database, 'database')}.${ident(schema, 'schema')}.${ident(name, 'object name')}`;
    const [row] = await this.#rows(`SELECT GET_DDL(${lit(domain)}, ${lit(qualified)}, TRUE) AS ddl`);
    return { objectId: qualified, kind, ddl: row?.ddl || null };
  }

  /**
   * Dependency lineage. ACCOUNT_USAGE.OBJECT_DEPENDENCIES is account-wide and covers
   * every object domain; VIEW_TABLE_USAGE is the ungranted fallback and only sees
   * view-to-table edges within one database. Task predecessors add the task DAG.
   */
  async getLineage({ objectId, depth = 2, limit = 400 } = {}) {
    const database = this.#requireDatabase();
    if (String(objectId || '').startsWith('task:')) {
      const parts = String(objectId).slice(5).split('.');
      if (parts.length !== 3 || ident(parts[0], 'database') !== database) throw new Error(`Snowflake task ${objectId} is outside configured database ${database}`);
    }
    const target = Math.max(1, Math.min(2000, Number(limit) || 400));
    const maxDepth = Math.max(1, Math.min(5, Number(depth) || 2));
    let edges = [];
    let source = null;
    let reason = null;

    if (this.accountUsage) {
      try {
        const rows = await this.#rows(`
          SELECT REFERENCED_DATABASE, REFERENCED_SCHEMA, REFERENCED_OBJECT_NAME, REFERENCED_OBJECT_DOMAIN,
                 REFERENCING_DATABASE, REFERENCING_SCHEMA, REFERENCING_OBJECT_NAME, REFERENCING_OBJECT_DOMAIN
          FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
          LIMIT ${target}`);
        edges = rows.map(row => ({
          from: qualify(row.referenced_database, row.referenced_schema, row.referenced_object_name),
          to: qualify(row.referencing_database, row.referencing_schema, row.referencing_object_name),
          fromKind: objectKind(row.referenced_object_domain),
          toKind: objectKind(row.referencing_object_domain),
          relationship: 'reads_from',
        }));
        source = 'account_usage.object_dependencies';
      } catch (error) { reason = unavailable(error); }
    }

    if (!source && database) {
      try {
        const rows = await this.#rows(`
          SELECT VIEW_CATALOG, VIEW_SCHEMA, VIEW_NAME, TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME
          FROM ${database}.INFORMATION_SCHEMA.VIEW_TABLE_USAGE
          LIMIT ${target}`);
        edges = rows.map(row => ({
          from: qualify(row.table_catalog, row.table_schema, row.table_name),
          to: qualify(row.view_catalog, row.view_schema, row.view_name),
          fromKind: 'table',
          toKind: 'view',
          relationship: 'reads_from',
        }));
        source = 'information_schema.view_table_usage';
        reason = reason ? `${reason} Falling back to view-to-table dependencies in ${this.database}.` : null;
      } catch (error) { reason = reason || unavailable(error); }
    }

    // Task predecessors are a genuine execution dependency and are invisible to the
    // object-dependency views, so they are merged in as a separate edge kind.
    try {
        const rows = await this.service.listVisibleTasks({ database, limit: target });
        for (const row of rows) {
          const to = `task:${qualify(row.database_name, row.schema_name, row.name)}`;
          for (const predecessor of parseList(row.predecessors)) {
            edges.push({ from: `task:${predecessor}`, to, fromKind: 'task', toKind: 'task', relationship: 'runs_after' });
          }
        }
    } catch { /* task DAG is additive; object lineage still stands without it */ }

    if (!source && !edges.length) {
      return { root: objectId || null, nodes: [], edges: [], source: null, reason: reason || 'No lineage source is readable with this role' };
    }

    const scoped = objectId ? walk(edges, String(objectId), maxDepth) : { edges: edges.slice(0, target), truncated: edges.length > target };
    const nodes = [...new Set(scoped.edges.flatMap(edge => [edge.from, edge.to]))].map(id => {
      const edge = scoped.edges.find(item => item.from === id) || scoped.edges.find(item => item.to === id);
      const kind = edge?.from === id ? edge.fromKind : edge?.toKind;
      return { id, label: id.split('.').at(-1), kind: kind || 'table', platform: 'snowflake', root: objectId ? id === String(objectId) : false };
    });
    return { root: objectId || null, nodes, edges: scoped.edges, truncated: scoped.truncated, source, reason };
  }
}

/**
 * INFORMATION_SCHEMA splits a column type across four fields. A reviewer reading a
 * schema wants NUMBER(38,2), not DATA_TYPE=NUMBER with the precision elsewhere.
 */
function formatType(row) {
  const base = String(row.data_type || '').toUpperCase();
  const length = num(row.character_maximum_length);
  const precision = num(row.numeric_precision);
  const scale = num(row.numeric_scale);
  if (length) return `${base}(${length})`;
  if (precision !== null) return scale ? `${base}(${precision},${scale})` : `${base}(${precision})`;
  return base;
}

/** PREDECESSORS and similar VARIANT columns arrive as JSON text or as an array. */
function parseList(value) {
  if (Array.isArray(value)) return value.map(String);
  const text = String(value ?? '').trim();
  if (!text || text === 'null') return [];
  try { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)]; }
  catch { return text.split(',').map(part => part.trim()).filter(Boolean); }
}

function splitPipelineId(pipelineId) {
  const text = String(pipelineId || '');
  const index = text.indexOf(':');
  return index === -1 ? ['task', text] : [text.slice(0, index), text.slice(index + 1)];
}

function splitObjectId(objectId, defaultDatabase, defaultSchema) {
  const parts = String(objectId || '').split('.').map(part => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error('A Snowflake object identifier is required');
  const [name, schema = defaultSchema, database = defaultDatabase] = [...parts].reverse();
  if (!database) throw new Error(`Qualify the object with a database, or set one on the connection: ${objectId}`);
  if (!schema) throw new Error(`Qualify the object with a schema, or set one on the connection: ${objectId}`);
  return { database: ident(database, 'database'), schema: ident(schema, 'schema'), name: ident(name, 'object name') };
}

/** Breadth-first walk in both directions so a node shows what feeds it and what it feeds. */
function walk(edges, root, maxDepth) {
  const kept = new Set();
  let frontier = new Set([root]);
  for (let level = 0; level < maxDepth; level += 1) {
    const next = new Set();
    for (const [index, edge] of edges.entries()) {
      if (frontier.has(edge.from) || frontier.has(edge.to)) {
        if (!kept.has(index)) { kept.add(index); next.add(edge.from); next.add(edge.to); }
      }
    }
    if (!next.size) break;
    frontier = next;
  }
  return { edges: [...kept].map(index => edges[index]), truncated: false };
}
