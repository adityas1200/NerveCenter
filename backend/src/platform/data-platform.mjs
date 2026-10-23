import { databricksFromConnection } from '../connectors/databricks/databricks-service.mjs';
import { SnowflakeMetadataService } from '../connectors/snowflake/snowflake-metadata.mjs';

/**
 * One contract over every data platform NerveCenter can read.
 *
 * Callers (the API, the MCP metadata server, the UI) ask for pipelines, runs,
 * tables, object code, and lineage without knowing whether the answer comes from
 * Databricks jobs and Unity Catalog or from Snowflake tasks and INFORMATION_SCHEMA.
 * Adding a third platform means adding a provider here, not touching callers.
 *
 * Shapes returned by every provider:
 *   pipeline { pipelineId, name, platform, kind, status, owner, schedule, lastRunAt }
 *   run      { runId, pipelineId, status, startTime, endTime, durationMs, failureSummary }
 *   table    { id, platform, database, schema, name, kind, rowCount, bytes, owner }
 *   detail   table + { columns[], ddl, upstream[], downstream[] }
 *   lineage  { root, nodes[{id,label,kind,platform}], edges[{from,to,relationship}] }
 */

export const DATA_PLATFORM_PROVIDERS = ['snowflake', 'databricks'];

const CAPABILITIES = {
  snowflake: { pipelines: true, runs: true, tables: true, ddl: true, lineage: true, pipelineKinds: ['task', 'pipe', 'dynamic_table'] },
  databricks: { pipelines: true, runs: true, tables: true, ddl: true, lineage: true, pipelineKinds: ['job'] },
};

const qualify = (...parts) => parts.filter(Boolean).join('.');
const num = value => (value === null || value === undefined || value === '' ? null : Number(value));
const iso = value => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(Number.isFinite(Number(value)) ? Number(value) : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export class DataPlatformService {
  /**
   * @param {object} options
   * @param {'snowflake'|'databricks'} options.provider
   * @param {object} [options.connection] resolved connection from ConnectionService
   */
  constructor({ provider, connection, snowflake, databricks } = {}) {
    this.provider = String(provider || '').toLowerCase();
    if (!DATA_PLATFORM_PROVIDERS.includes(this.provider)) throw new Error(`Unsupported data platform: ${provider}`);
    this.connection = connection || null;
    this._snowflake = snowflake || null;
    this._databricks = databricks || null;
  }

  static fromConnection(provider, connection) {
    return new DataPlatformService({ provider, connection });
  }

  capabilities() { return { provider: this.provider, ...CAPABILITIES[this.provider] }; }

  get snowflake() {
    if (!this._snowflake) this._snowflake = new SnowflakeMetadataService({ connection: this.connection });
    return this._snowflake;
  }

  get databricks() {
    if (!this._databricks) this._databricks = databricksFromConnection(this.connection || {});
    return this._databricks;
  }

  async listPipelines(args = {}) {
    if (this.provider === 'snowflake') return this.snowflake.listPipelines(args);
    const pipelines = await this.databricks.listPipelines(args);
    return { pipelines: pipelines.map(item => ({ ...item, kind: 'job' })), sources: [{ id: 'databricks.jobs', status: 'ok', count: pipelines.length }] };
  }

  async getPipeline(args) {
    if (this.provider === 'snowflake') return this.snowflake.getPipeline(args);
    return { ...(await this.databricks.getPipeline(args)), kind: 'job' };
  }

  async listRuns(args = {}) {
    if (this.provider === 'snowflake') return this.snowflake.listRuns(args);
    return this.databricks.listRuns(args);
  }

  async getRun(args) {
    if (this.provider === 'snowflake') return this.snowflake.getRun(args);
    return this.databricks.getRun(args);
  }

  async collectRcaEvidence(args) {
    if (this.provider === 'snowflake') return this.snowflake.collectRcaEvidence(args);
    return this.databricks.collectRcaEvidence(args);
  }

  async retriggerPipeline(args) {
    if (this.provider === 'snowflake') return this.snowflake.retriggerPipeline(args);
    return this.databricks.retriggerPipeline(args);
  }

  async getRemediationResult(args) {
    if (this.provider === 'snowflake') return this.snowflake.getRemediationResult(args);
    return this.databricks.getRemediationResult(args);
  }

  async listTables(args = {}) {
    if (this.provider === 'snowflake') return this.snowflake.listTables(args);
    return this.#databricksListTables(args);
  }

  async getTable(args) {
    if (this.provider === 'snowflake') return this.snowflake.getTable(args);
    return this.#databricksGetTable(args);
  }

  async getDdl(args) {
    if (this.provider === 'snowflake') return this.snowflake.getDdl(args);
    const table = await this.#databricksGetTable({ objectId: args.objectId });
    return { objectId: table.id, kind: table.kind, ddl: table.ddl };
  }

  async getLineage(args = {}) {
    if (this.provider === 'snowflake') return this.snowflake.getLineage(args);
    if (args.objectId) return this.#databricksTableLineage(args);
    // Without a table, Databricks lineage is the task graph of one run.
    const lineage = await this.databricks.getLineage(args);
    return {
      root: args.runId ? String(args.runId) : null,
      nodes: (lineage.nodes || []).map(node => ({ id: node.taskKey, label: node.taskKey, kind: 'task', platform: 'databricks', status: node.state })),
      edges: (lineage.edges || []).map(edge => ({ ...edge, relationship: 'runs_after' })),
      source: 'databricks.run_task_graph',
    };
  }

  // Unity Catalog is the only Databricks surface with table metadata and column
  // comments, so table browsing requires it. Workspaces on the legacy Hive
  // metastore report the reason instead of an empty list.
  async #databricksListTables({ catalog, schema, search = '', limit = 500 } = {}) {
    const target = Math.max(1, Math.min(2000, Number(limit) || 500));
    const client = this.databricks.client();
    const catalogName = catalog || this.connection?.config?.catalog || '';
    const schemaName = schema || this.connection?.config?.schema || '';
    if (!catalogName || !schemaName) throw new Error('Set a Unity Catalog catalog and schema to browse Databricks tables');
    const tables = [];
    let pageToken;
    do {
      const payload = await client.get('/api/2.1/unity-catalog/tables', { catalog_name: catalogName, schema_name: schemaName, max_results: Math.min(50, target - tables.length), page_token: pageToken });
      tables.push(...(payload.tables || []));
      pageToken = payload.next_page_token || null;
    } while (pageToken && tables.length < target);
    return tables
      .filter(table => !search || String(table.name || '').toLowerCase().includes(String(search).toLowerCase()))
      .slice(0, target)
      .map(table => normalizeDatabricksTable(table));
  }

  async #databricksGetTable({ objectId, id } = {}) {
    const fullName = String(objectId || id || '');
    if (fullName.split('.').length !== 3) throw new Error(`Databricks tables must be a three-part Unity Catalog name: ${fullName}`);
    const table = await this.databricks.client().get(`/api/2.1/unity-catalog/tables/${encodeURIComponent(fullName)}`);
    const lineage = await this.#databricksTableLineage({ objectId: fullName }).catch(() => null);
    return {
      ...normalizeDatabricksTable(table),
      columns: (table.columns || []).map(column => ({ name: column.name, position: num(column.position), type: column.type_text || column.type_name, nullable: column.nullable !== false, default: column.column_default ?? null, comment: column.comment || null })),
      ddl: table.view_definition || null,
      upstream: lineage?.edges?.filter(edge => edge.to === fullName).map(edge => edge.from) ?? [],
      downstream: lineage?.edges?.filter(edge => edge.from === fullName).map(edge => edge.to) ?? [],
      lineageUnavailableReason: lineage?.reason || null,
    };
  }

  async #databricksTableLineage({ objectId }) {
    const fullName = String(objectId || '');
    try {
      const payload = await this.databricks.client().get('/api/2.0/lineage-tracking/table-lineage', { table_name: fullName, include_entity_lineage: 'true' });
      const edges = [
        ...(payload.upstreams || []).map(item => ({ from: item.tableInfo?.name ? qualify(item.tableInfo.catalog_name, item.tableInfo.schema_name, item.tableInfo.name) : null, to: fullName, relationship: 'reads_from', fromKind: 'table', toKind: 'table' })),
        ...(payload.downstreams || []).map(item => ({ from: fullName, to: item.tableInfo?.name ? qualify(item.tableInfo.catalog_name, item.tableInfo.schema_name, item.tableInfo.name) : null, relationship: 'reads_from', fromKind: 'table', toKind: 'table' })),
      ].filter(edge => edge.from && edge.to);
      const nodes = [...new Set(edges.flatMap(edge => [edge.from, edge.to]))].map(nodeId => ({ id: nodeId, label: nodeId.split('.').at(-1), kind: 'table', platform: 'databricks', root: nodeId === fullName }));
      return { root: fullName, nodes, edges, source: 'databricks.lineage_tracking' };
    } catch (error) {
      return { root: fullName, nodes: [], edges: [], source: null, reason: String(error?.message || error).slice(0, 300) };
    }
  }
}

function normalizeDatabricksTable(table = {}) {
  const id = qualify(table.catalog_name, table.schema_name, table.name);
  return {
    id,
    platform: 'databricks',
    database: table.catalog_name || null,
    schema: table.schema_name || null,
    name: table.name || null,
    kind: String(table.table_type || 'table').toLowerCase(),
    rowCount: null,
    bytes: null,
    owner: table.owner || null,
    comment: table.comment || null,
    createdAt: iso(table.created_at),
    lastAlteredAt: iso(table.updated_at),
    format: table.data_source_format || null,
    location: table.storage_location || null,
  };
}
