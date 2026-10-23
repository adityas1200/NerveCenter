// The connector cards. Each says which non-secret fields to ask for, which secrets, how the
// agent reaches the system (an MCP server rendered into .mcp.json with ${ENV} references), and
// whether the data pages get a direct client too (a managed connection profile).
//
// Secrets never enter operations.yaml. They live in the secret store under connectors/<id>/<ENV>
// and are injected as environment variables into every agent session.

export const CONNECTORS = {
  databricks: {
    id: 'databricks', name: 'Databricks', short: 'DB',
    description: 'Pipelines, data quality and RCA read the jobs and SQL APIs. Job runs and data changes follow your policy.',
    usedBy: ['Pipelines', 'Data Quality', 'Tasks'],
    fields: [
      { key: 'host', label: 'Workspace URL', placeholder: 'https://adb-1234567890.1.azuredatabricks.net', required: true, env: 'DATABRICKS_HOST' },
      // A service principal is a workspace-owned identity, so access does not break when a person leaves.
      { key: 'authMode', label: 'Authenticate as', required: false, default: 'pat', choices: [{ value: 'pat', label: 'A person (access token)' }, { value: 'service_principal', label: 'A service principal (OAuth)' }] },
      { key: 'clientId', label: 'Client ID', placeholder: '00000000-0000-0000-0000-000000000000', required: true, env: 'DATABRICKS_CLIENT_ID', when: { authMode: 'service_principal' } },
      { key: 'warehouseId', label: 'SQL warehouse ID', placeholder: 'abcdef1234567890', required: false, env: 'DATABRICKS_WAREHOUSE_ID' },
    ],
    secrets: [
      { key: 'token', label: 'Personal access token', env: 'DATABRICKS_TOKEN', required: true, when: { authMode: 'pat' } },
      { key: 'clientSecret', label: 'Client secret (OAuth)', env: 'DATABRICKS_CLIENT_SECRET', required: true, when: { authMode: 'service_principal' } },
    ],
    managedProfile: {
      provider: 'databricks',
      config: settings => ({ host: settings.host, authMode: settings.authMode || 'pat' }),
      credentials: (secrets, settings) => settings.authMode === 'service_principal' ? { clientId: settings.clientId, clientSecret: secrets.clientSecret } : { token: secrets.token },
    },
    // databricks-mcp-server (PyPI) reads DATABRICKS_HOST, DATABRICKS_TOKEN and DATABRICKS_WAREHOUSE_ID.
    // DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET are the Databricks SDK's own names for a
    // service principal, so a server built on the SDK picks them up without extra configuration.
    mcp: { transport: 'stdio', command: 'uvx', args: ['databricks-mcp-server'], env: ['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'DATABRICKS_CLIENT_ID', 'DATABRICKS_CLIENT_SECRET', 'DATABRICKS_WAREHOUSE_ID'] },
    operations: settings => ({ platforms: [{ name: 'databricks', type: 'databricks', connection: 'databricks', environments: { default: { workspace: settings.host, writable: false } } }] }),
  },
  servicenow: {
    id: 'servicenow', name: 'ServiceNow', short: 'SN',
    description: 'Incidents in scope become tickets. Comments, assignments and state changes made in NerveCenter are saved back to ServiceNow.',
    usedBy: ['Tickets', 'Tasks'],
    fields: [{ key: 'instance', label: 'Instance URL', placeholder: 'https://company.service-now.com', required: true, env: 'SERVICENOW_INSTANCE_URL' }],
    secrets: [{ key: 'username', label: 'Username', env: 'SERVICENOW_USERNAME', required: true }, { key: 'password', label: 'Password', env: 'SERVICENOW_PASSWORD', required: true }],
    managedProfile: { provider: 'servicenow', config: settings => ({ instance: settings.instance }), credentials: secrets => ({ username: secrets.username, password: secrets.password }) },
    // The PyPI name "servicenow-mcp" is an unrelated, broken package; the echelon server is installed from GitHub.
    mcp: { transport: 'stdio', command: 'uvx', args: ['--from', 'git+https://github.com/echelon-ai-labs/servicenow-mcp', 'servicenow-mcp'], env: ['SERVICENOW_INSTANCE_URL', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD'], extraEnv: { SERVICENOW_AUTH_TYPE: 'basic' } },
    operations: () => ({ ticketing: { platform: 'servicenow', connection: 'servicenow' } }),
  },
  atlassian: {
    id: 'atlassian', name: 'Atlassian', short: 'A',
    description: 'Jira issues become tickets. Comments, assignments and transitions made in NerveCenter are saved back to Jira.',
    usedBy: ['Tickets', 'Tasks', 'Knowledge'],
    fields: [
      { key: 'site', label: 'Jira site URL', placeholder: 'https://company.atlassian.net', required: true, env: 'JIRA_URL' },
      { key: 'email', label: 'Account email', placeholder: 'you@company.com', required: true, env: 'JIRA_USERNAME' },
      { key: 'project', label: 'Default Jira project key', placeholder: 'DATAOPS', required: false },
    ],
    secrets: [{ key: 'apiToken', label: 'API token', env: 'JIRA_API_TOKEN', required: true }],
    managedProfile: { provider: 'jira', config: settings => ({ site: settings.site, email: settings.email, project: settings.project || '' }), credentials: secrets => ({ apiToken: secrets.apiToken }) },
    mcp: { transport: 'stdio', command: 'uvx', args: ['mcp-atlassian'], env: ['JIRA_URL', 'JIRA_USERNAME', 'JIRA_API_TOKEN'] },
    operations: settings => ({ ticketing: { platform: 'jira', connection: 'atlassian', scope: { site: settings.site, project: settings.project || '' } } }),
  },
  github: {
    id: 'github', name: 'GitHub', short: 'GH', kind: 'cli',
    description: 'Keeps the code repository, pull requests, checks and Git-backed knowledge current.',
    usedBy: ['Tickets', 'Tasks', 'Knowledge'],
    fields: [
      { key: 'repository', label: 'Repository', placeholder: 'company/data-platform', required: true },
      { key: 'defaultBranch', label: 'Default branch', placeholder: 'main', required: false, default: 'main' },
    ],
    secrets: [{ key: 'token', label: 'Personal access token', env: 'GITHUB_TOKEN', required: true }],
    cli: { command: 'gh' },
    operations: settings => ({ source_control: { platform: 'github', connection: 'github', repository: settings.repository, default_branch: settings.defaultBranch || 'main' } }),
  },
  snowflake: {
    id: 'snowflake', name: 'Snowflake', short: 'SF',
    description: 'Warehouse runs, DQ checks and access grants for Snowflake-backed marts.',
    usedBy: ['Pipelines', 'Data Quality', 'Tasks'],
    fields: [
      { key: 'account', label: 'Account identifier', placeholder: 'org-account.region.cloud', required: true, env: 'SNOWFLAKE_ACCOUNT' },
      { key: 'warehouse', label: 'Warehouse', placeholder: 'COMPUTE_WH', required: false, env: 'SNOWFLAKE_WAREHOUSE' },
      { key: 'database', label: 'Database', placeholder: 'ANALYTICS', required: false, env: 'SNOWFLAKE_DATABASE' },
      { key: 'schema', label: 'Schema', placeholder: 'PUBLIC', required: false, env: 'SNOWFLAKE_SCHEMA' },
      { key: 'role', label: 'Role', placeholder: 'ANALYST', required: false, env: 'SNOWFLAKE_ROLE' },
    ],
    secrets: [{ key: 'username', label: 'Username', env: 'SNOWFLAKE_USER', required: true }, { key: 'password', label: 'Password', env: 'SNOWFLAKE_PASSWORD', required: true }],
    managedProfile: { provider: 'snowflake', config: settings => ({ account: settings.account, warehouse: settings.warehouse, database: settings.database, schema: settings.schema, role: settings.role }), credentials: secrets => ({ authType: 'password', username: secrets.username, password: secrets.password }) },
    mcp: { transport: 'stdio', command: 'uvx', args: ['mcp-snowflake-server'], env: ['SNOWFLAKE_ACCOUNT', 'SNOWFLAKE_USER', 'SNOWFLAKE_PASSWORD', 'SNOWFLAKE_WAREHOUSE', 'SNOWFLAKE_DATABASE', 'SNOWFLAKE_SCHEMA', 'SNOWFLAKE_ROLE'] },
    operations: settings => ({ platforms: [{ name: 'snowflake', type: 'snowflake', connection: 'snowflake', environments: { default: { account: settings.account, writable: false } } }] }),
  },
};

// SharePoint is a connector like any other: an MCP server the agent uses to read documents (for
// knowledge and research) and to save reports and data extracts to a document library. It signs in
// as an Entra app (client credentials) that an admin grants to this one site (Sites.Selected), so it
// works without a person's session. Uploads are changes, so they follow the workspace policy.
// mcp-sharepoint (PyPI, MIT, github.com/Sofias-ai/mcp-sharepoint) reads the SHP_* variables below;
// a client with its own SharePoint MCP server adds it as a custom connector instead.
CONNECTORS.sharepoint = {
  id: 'sharepoint', name: 'SharePoint', short: 'SP',
  description: 'Reads documents for knowledge and research, and saves reports and data extracts to a document library. Uploads follow your policy.',
  usedBy: ['Tasks', 'Knowledge'],
  fields: [
    { key: 'site', label: 'Site URL', placeholder: 'https://company.sharepoint.com/sites/dataops', required: true, env: 'SHP_SITE_URL' },
    { key: 'library', label: 'Document library', placeholder: 'Shared Documents', required: false, default: 'Shared Documents', env: 'SHP_DOC_LIBRARY' },
    { key: 'tenantId', label: 'Directory (tenant) ID', placeholder: '00000000-0000-0000-0000-000000000000', required: true, env: 'SHP_TENANT_ID' },
    { key: 'clientId', label: 'Application (client) ID', placeholder: '00000000-0000-0000-0000-000000000000', required: true, env: 'SHP_ID_APP' },
  ],
  secrets: [{ key: 'clientSecret', label: 'Client secret', env: 'SHP_ID_APP_SECRET', required: true }],
  mcp: { transport: 'stdio', command: 'uvx', args: ['mcp-sharepoint'], env: ['SHP_SITE_URL', 'SHP_DOC_LIBRARY', 'SHP_TENANT_ID', 'SHP_ID_APP', 'SHP_ID_APP_SECRET'] },
  operations: settings => ({ documents: { connection: 'sharepoint', destinations: { sharepoint: { site: settings.site, library: settings.library || 'Shared Documents' } } } }),
};

// Email has no MCP server: the agent sends reviewed previews with the plugin's send_email.py over SMTP.
// Microsoft 365 (smtp.office365.com:587) and Google Workspace work when the tenant allows SMTP AUTH.
CONNECTORS.email = {
  id: 'email', name: 'Email (SMTP)', short: 'SMTP', kind: 'smtp',
  description: 'Sends approved emails, reports and data extracts from your mail server. Every send follows your email policy.',
  usedBy: ['Tasks', 'Routines'],
  fields: [
    { key: 'server', label: 'SMTP server', placeholder: 'smtp.office365.com', required: true, env: 'SMTP_HOST' },
    { key: 'port', label: 'Port', placeholder: '587', required: false, env: 'SMTP_PORT' },
    { key: 'security', label: 'Security (starttls, ssl or none)', placeholder: 'starttls', required: false, env: 'SMTP_SECURITY' },
    { key: 'sender', label: 'Send as', placeholder: 'dataops@company.com', required: true },
    { key: 'domains', label: 'Internal mail domains', placeholder: 'company.com, company.co.uk', required: false },
  ],
  secrets: [{ key: 'username', label: 'Username', env: 'SMTP_USERNAME', required: false }, { key: 'password', label: 'Password or app password', env: 'SMTP_PASSWORD', required: false }],
  // The plugin's sender reads communication.notifications_enabled and communication.smtp from operations.yaml
  // (environment variables override them), so saving the connector is enough for the agent to send.
  operations: settings => {
    const security = String(settings.security || 'starttls').toLowerCase();
    const port = Number(settings.port) || (security === 'ssl' ? 465 : security === 'none' ? 25 : 587);
    return { communication: { platform: 'smtp', connection: 'email', notifications_enabled: true, sender: settings.sender, smtp: { host: settings.server, port, use_tls: security !== 'none', security }, ...(settings.domains ? { internal_domains: settings.domains.split(/[\s,;]+/).map(domain => domain.replace(/^@/, '').toLowerCase()).filter(Boolean) } : {}) } };
  },
};

export const CUSTOM = {
  id: 'custom', name: 'Custom MCP server', short: 'MCP',
  description: 'Any MCP server the agent should be able to use: a URL, or a command with arguments.',
  usedBy: ['Tasks'],
};

/**
 * Some fields and secrets only belong to one way of connecting: a Databricks personal access token
 * is asked for when the connector authenticates as a person, the client ID and secret when it
 * authenticates as a service principal. `when: { authMode: 'service_principal' }` says so, and both
 * the form and the save path read it from here, so the two never disagree about what is required.
 */
export function applies(entry, settings = {}) {
  return Object.entries(entry?.when || {}).every(([key, value]) => (settings[key] ?? '') === value);
}
/** The saved settings with every field default filled in, which is what `applies` is judged against. */
export function withDefaults(def, settings = {}) {
  const values = { ...settings };
  for (const field of def?.fields || []) if (field.default !== undefined && !String(values[field.key] ?? '').trim()) values[field.key] = field.default;
  return values;
}

export function catalog() { return [...Object.values(CONNECTORS), CUSTOM].map(({ managedProfile, mcp, cli, operations, kind, ...card }) => ({ ...card, fields: card.fields || [], secrets: (card.secrets || []).map(({ key, label, env, required, when }) => ({ key, label, env, required, ...(when ? { when } : {}) })), hasMcpDefault: Boolean(mcp), ...(kind ? { connectionKind: kind } : {}) })); }
export function definition(id) { return CONNECTORS[id] || null; }
