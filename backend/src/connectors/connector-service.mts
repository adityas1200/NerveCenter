import { normalizeOrigin } from '../lib/endpoint.mjs';
import { CONNECTORS, CUSTOM, applies, catalog, definition, withDefaults } from './connector-catalog.mjs';
import { now, cleanString as clean, httpError } from '../lib/util.mjs';
import { PerProject } from '../projects/project-bound.mjs';
import { asRegistry } from '../workspace/workspace.mjs';
import type { SecretStore } from '../secrets/secret-store.mjs';
import type { ConnectionService } from '../connections/connection-service.mjs';

type StringRecord = Record<string, string>;
type WorkspaceConnection = { kind?: string; transport?: string; command?: string; args?: string[]; url?: string; base_url?: string; auth?: string; provider?: string; repository?: string; branch?: string; env?: StringRecord; enabled?: boolean };
type ConnectorMetadata = { title?: string; description?: string; custom?: boolean; knowledge?: boolean; updatedAt?: string; settings?: Record<string, unknown> };
type OperationsDoc = Record<string, unknown> & { connections?: Record<string, WorkspaceConnection>; connectors?: Record<string, ConnectorMetadata>; knowledge?: { connection?: string }; communication?: Record<string, unknown>; source_control?: Record<string, unknown>; platforms?: Array<Record<string, unknown>>; ticketing?: Record<string, unknown> };
type WorkspaceAccess = { projectId?: string; readOperations(): Promise<OperationsDoc>; setConnection(id: string, connection: WorkspaceConnection): Promise<unknown>; removeConnection(id: string): Promise<unknown>; updateOperations(update: (current: OperationsDoc) => OperationsDoc | Promise<OperationsDoc>): Promise<unknown> };
type ConnectorField = { key: string; label: string; required?: boolean; env?: string; default?: string; choices?: Array<{ value: string; label: string }> };
type ConnectorSecret = { key: string; label: string; env: string; required?: boolean; when?: Record<string, string> };
type ConnectorMcp = { transport?: string; command?: string; args?: string[]; url?: string; extraEnv?: StringRecord };
type ConnectorDefinition = { id: string; name: string; short: string; description: string; kind?: string; fields: ConnectorField[]; secrets: ConnectorSecret[]; mcp?: ConnectorMcp; cli?: { command: string; args?: string[] }; managedProfile?: { provider: string; config(settings: StringRecord): Record<string, string | undefined>; credentials(secrets: Record<string, string | undefined>, settings: StringRecord): Record<string, string | undefined> }; operations?: (settings: StringRecord) => OperationsDoc };
type ConnectorCard = { id: string; name: string; short: string; description: string; usedBy?: string[]; fields?: ConnectorField[]; secrets?: ConnectorSecret[]; connectionKind?: string; hasMcpDefault?: boolean };
type ConnectorStoreService = { providerStatuses(projectId?: string): Promise<Array<{ id?: string; provider?: string; configured?: boolean; ready?: boolean; verified?: boolean; reason?: string; lastTest?: unknown }>>; getDefault(provider: string, projectId?: string): Promise<{ id: string } | null>; setDefault?(id: string, projectId: string): Promise<unknown>; test(id: string): Promise<{ lastTest?: { status?: string; message?: string } }>; save(input: Record<string, unknown>): Promise<unknown>; delete(id: string): Promise<unknown> };
type ConnectorGrants = { put(projectId: string, grant: { resourceType: 'connection'; resourceId: string; scope: Record<string, never>; isDefault: boolean }): Promise<unknown>; revoke(projectId: string, resourceType: 'connection', resourceId: string): Promise<unknown> };
type ConnectorInput = { settings?: StringRecord; secrets?: StringRecord; mcp?: { transport?: string; command?: string; args?: string[] | string; url?: string }; enabled?: boolean };
type CustomInput = { kind?: string; name?: string; title?: string; description?: string; transport?: string; url?: string; command?: string; args?: string[] | string; env?: StringRecord; baseUrl?: string; base_url?: string; auth?: string; token?: string; repository?: string; branch?: string; knowledge?: boolean };
type ConnectionUse = { section: string; label: string; does?: string };
type ConnectorWorkspaceRegistry = { for(id: string): Promise<WorkspaceAccess> };
const connectorCards = (): ConnectorCard[] => catalog() as ConnectorCard[];
const connectorDefinition = (id: string): ConnectorDefinition | null => definition(id) as ConnectorDefinition | null;
const catalogDefinition = CONNECTORS as unknown as Record<string, ConnectorDefinition>;
const fieldApplies = (entry: ConnectorField | ConnectorSecret, settings: StringRecord) => applies(entry, settings);
const applyDefaults = (def: ConnectorDefinition, settings: StringRecord) => withDefaults(def, settings) as StringRecord;

// One place that connects a system for both consumers at once: the data pages (a managed
// connection profile with credentials in the secret store) and the agent (an MCP entry in
// operations.yaml, rendered to .mcp.json with ${ENV} references, env injected per session).

const slug = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
/** The secret behind a connector's environment variable. Qualified with the project (FR-24); a workspace with no project keeps the old global ref. */
export const connectorSecretRef = (id: string, env: string, projectId: string | null = null) => (projectId ? `projects/${projectId}/connectors/${id}/${env}` : `connectors/${id}/${env}`);
/** Every connector secret ref a workspace's operations.yaml points at, in the old global form (what the PILOT migration copies). */
export function connectorSecretNames(operations: OperationsDoc = {}) {
  const refs = new Set();
  for (const [id, connection] of Object.entries(operations.connections || {})) {
    for (const secret of connectorDefinition(id)?.secrets || []) refs.add(`connectors/${id}/${secret.env}`);
    for (const value of Object.values(connection?.env || {})) { const match = /^\$\{([A-Z][A-Z0-9_]*)\}$/.exec(String(value)); if (match) refs.add(`connectors/${id}/${match[1]}`); }
  }
  return [...refs];
}

/**
 * Mail server settings from the deployment environment (SMTP_HOST, SMTP_PORT, SMTP_USE_TLS or
 * SMTP_SECURITY). A deployment that sets these has an Email connector without saving the form,
 * the same way the plugin's sender reads them.
 */
export function smtpFromEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const server = clean(env.SMTP_HOST); if (!server) return null;
  const explicit = clean(env.SMTP_SECURITY).toLowerCase();
  const useTls = /^(true|1|yes|on)$/i.test(clean(env.SMTP_USE_TLS));
  const security = ['starttls', 'ssl', 'none'].includes(explicit) ? explicit : useTls ? 'starttls' : 'none';
  const port = Number(env.SMTP_PORT) || (security === 'ssl' ? 465 : security === 'none' ? 25 : 587);
  return { server, port: String(port), security };
}

/** Connect to a mail server and read its greeting. Resolves to null when it answers, else to one plain reason. */
async function probeSmtp(host: string, port: number, security = 'starttls', timeoutMs = 5000): Promise<string | null> {
  const { connect } = await import('node:net');
  return new Promise<string | null>(resolve => {
    const socket = connect({ host, port, timeout: timeoutMs });
    const done = (result: string | null) => { socket.destroy(); resolve(result); };
    if (security === 'ssl') socket.once('connect', () => done(null));
    socket.once('data', data => done(String(data).slice(0, 3) === '220' ? null : `answered "${String(data).trim().slice(0, 80)}" instead of an SMTP greeting`));
    socket.once('timeout', () => done(`did not answer within ${Math.round(timeoutMs / 1000)} seconds from this machine: the network route to the mail server is missing (VPN, firewall or wrong network)`));
    socket.once('error', error => { const code = (error as NodeJS.ErrnoException).code; done(code === 'ECONNREFUSED' ? `refused the connection: nothing is listening on port ${port}` : code === 'ENOTFOUND' ? 'could not be resolved: check the server name' : error.message); });
  });
}

// An instance serves ONE project: its operations.yaml, its secrets (`projects/<id>/connectors/...`) and the connection profiles
// granted to it. `Connectors` (bottom of the file) builds one per project.
export class ConnectorService {
  workspace!: WorkspaceAccess;
  secretStore!: SecretStore;
  connectionService?: ConnectorStoreService;
  grants?: ConnectorGrants;
  env!: NodeJS.ProcessEnv;
  projectId!: string | null;
  constructor({ workspace, secretStore, connectionService, grants, env = process.env }: { workspace: WorkspaceAccess; secretStore: SecretStore; connectionService?: ConnectorStoreService; grants?: ConnectorGrants; env?: NodeJS.ProcessEnv }) {
    Object.assign(this, { workspace, secretStore, connectionService, grants, env });
    this.projectId = workspace.projectId || null;
  }
  profileId(provider: string) { return `${provider}-nervecenter${this.projectId ? `-${this.projectId}` : ''}`; }
  ref(id: string, env: string) { return connectorSecretRef(id, env, this.projectId); }

  /** Cards for the Connectors page: catalog entries plus every connection in operations.yaml, with state. */
  async list(): Promise<Array<Record<string, unknown>>> {
    const operations = await this.workspace.readOperations();
    const connections = operations.connections || {};
    const meta = operations.connectors || {};
    const statuses = await (this.connectionService?.providerStatuses?.(this.projectId || undefined).catch(() => []) || []);
    const knowledgeConnection = clean(operations.knowledge?.connection);
    const cards = [];
    for (const card of connectorCards()) {
      if (card.id === 'custom') continue;
      const connection = connections[card.id];
      const status = statuses.find(item => item.id === (catalogDefinition[card.id].managedProfile?.provider || card.id) || item.provider === catalogDefinition[card.id].managedProfile?.provider);
      // Email needs no saved form when the deployment sets SMTP_HOST: the card shows those settings as "from environment".
      const envSmtp = card.id === 'email' && !connection ? smtpFromEnvironment(this.env) : null;
      const configured = Boolean(connection) || Boolean(status?.configured) || Boolean(envSmtp);
      const ready = status ? Boolean(status.ready && status.verified !== false) : Boolean(connection) || Boolean(envSmtp);
      const settings = envSmtp ? { ...envSmtp, ...(clean(operations.communication?.sender) ? { sender: clean(operations.communication!.sender) } : {}), ...(meta[card.id]?.settings || {}) } : meta[card.id]?.settings || {};
      cards.push({ ...card, kind: 'catalog', connectionKind: card.connectionKind || 'mcp', configured, source: connection ? 'workspace' : configured ? 'environment' : null, state: !configured ? 'not_connected' : ready ? 'connected' : 'error', reason: status?.reason || null, lastTest: status?.lastTest || null, settings, secretsSet: await this.#secretsSet(card.id), mcp: connection ? publicMcp(connection) : null, usedFor: connectionUses(operations, card.id), knowledgeSource: knowledgeConnection === card.id, updatedAt: meta[card.id]?.updatedAt || null });
    }
    for (const [name, connection] of Object.entries(connections)) {
      if (catalogDefinition[name]) continue;
      // Anything else in `connections`: a custom MCP server from the Connectors page, or an api/cli/native
      // connection the setup skill wrote. The card says which, so "Connected" is not read as "MCP server".
      const kind = connection.kind || 'mcp';
      const uses = connectionUses(operations, name);
      const settings = kind === 'api' ? { base_url: connection.base_url || '', ...(connection.auth ? { auth: String(connection.auth) } : {}), ...(connection.provider ? { provider: String(connection.provider) } : {}) } : kind === 'cli' ? { command: connection.command || '', ...(connection.repository ? { repository: String(connection.repository), branch: String(connection.branch || '') } : {}) } : {};
      cards.push({ ...CUSTOM, id: name, name: meta[name]?.title || humanize(name), description: clean(meta[name]?.description) || describeConnection(kind, uses), kind: 'custom', connectionKind: kind, endpoint: connectionEndpoint(connection), origin: meta[name]?.custom ? 'connectors' : 'operations', configured: true, source: 'workspace', state: 'connected', reason: null, settings, secretsSet: [], mcp: kind === 'mcp' ? publicMcp(connection) : null, usedFor: uses, knowledgeSource: knowledgeConnection === name, updatedAt: meta[name]?.updatedAt || null });
    }
    return cards;
  }

  /** Save a catalog connector: non-secret settings, secrets, and (optionally) an MCP override. */
  async save(id: string, { settings = {}, secrets = {}, mcp: mcpOverride, enabled = true }: ConnectorInput = {}) {
    const def = connectorDefinition(id); if (!def) throw httpError(404, `Unknown connector: ${id}`);
    // A connector can offer more than one way of connecting (Databricks: as a person, or as a service
    // principal). Only the fields and secrets of the chosen way are asked for, saved, or required.
    const chosen = applyDefaults(def, settings);
    const fields = def.fields.filter(field => fieldApplies(field, chosen));
    const values: StringRecord = {};
    for (const field of fields) {
      const value = clean(settings[field.key]) || clean(field.default);
      if (field.choices && value && !field.choices.some(choice => choice.value === value)) throw new Error(`${field.label} must be one of: ${field.choices.map(choice => choice.label).join(', ')}`);
      if (field.required && !value) throw new Error(`${field.label} is required`);
      if (value) values[field.key] = value;
    }
    for (const key of ['host', 'instance', 'site']) if (values[key]) values[key] = normalizeOrigin(values[key], { label: def.fields.find(field => field.key === key)?.label || 'URL' });
    // Secrets belonging to a way of connecting that was not chosen are forgotten, so switching to a
    // service principal does not leave a personal access token behind in the agent's environment.
    const wanted = def.secrets.filter(secret => fieldApplies(secret, values));
    for (const secret of def.secrets) if (!wanted.includes(secret)) await this.secretStore.delete(this.ref(id, secret.env)).catch(() => {});
    const existingSecrets = await this.#secretsSet(id);
    for (const secret of wanted) { const value = clean(secrets[secret.key]); if (value) await this.secretStore.set(this.ref(id, secret.env), value); else if (secret.required && !existingSecrets.includes(secret.env)) throw new Error(`${secret.label} is required`); }
    // Agent side: the connection with ${ENV} references only. A catalog entry without an MCP server
    // (email over SMTP) is saved as its own kind; the agent reads the same variables from its environment.
    const env: StringRecord = {}; for (const field of fields) if (field.env && values[field.key]) env[field.env] = `\${${field.env}}`; const storedSecrets = await this.#secretsSet(id); for (const secret of wanted) if (secret.required || storedSecrets.includes(secret.env)) env[secret.env] = `\${${secret.env}}`; Object.assign(env, def.mcp?.extraEnv || {});
    let connection: WorkspaceConnection;
    if (def.mcp) { const mcp = normalizeMcp(mcpOverride || {}, def.mcp); connection = { kind: 'mcp', transport: mcp.transport, ...(mcp.transport === 'stdio' ? { command: mcp.command, args: mcp.args } : { url: mcp.url }), env, enabled: enabled !== false }; }
    else if (def.cli) connection = { kind: 'cli', command: def.cli.command, ...(def.cli.args?.length ? { args: def.cli.args } : {}), env, enabled: enabled !== false };
    else connection = { kind: def.kind, env, enabled: enabled !== false };
    await this.workspace.setConnection(id, connection);
    await this.workspace.updateOperations(current => mergeOperations(current, def.operations?.(values) || {}, { id, settings: values }));
    // Data-page side: a managed profile with real credentials in the secret store.
    if (def.managedProfile && this.connectionService) {
      const resolved = await this.#secretValues(id, wanted);
      const credentials = def.managedProfile.credentials(resolved, values);
      if (Object.values(credentials).every(Boolean)) {
        const profileId = this.profileId(def.managedProfile.provider);
        await this.connectionService.save({ id: profileId, provider: def.managedProfile.provider, name: def.name, config: def.managedProfile.config(values), credentials, isDefault: true, enabled: enabled !== false });
        if (this.projectId && this.grants) {
          await this.grants.put(this.projectId, { resourceType: 'connection', resourceId: profileId, scope: {}, isDefault: true });
          await this.connectionService.setDefault?.(profileId, this.projectId);
        }
      }
    }
    return (await this.list()).find(card => card.id === id);
  }

  /**
   * Save a custom connection from the Connectors page. `kind` picks the shape:
   * - mcp: a name plus a URL or a command, like a Claude Code .mcp.json entry;
   * - api: a REST API base URL the agent calls directly, with an optional bearer token;
   * - cli: a command-line tool the agent runs (git, gh, az…).
   * Env values and tokens are stored in the secret store and referenced as ${VAR} in operations.yaml.
   */
  async saveCustom({ kind = 'mcp', name, title, description, transport, url, command, args = [], env = {}, baseUrl, base_url: baseUrlSnake, auth, token, repository, branch, knowledge = false }: CustomInput = {}) {
    const id = slug(name || title); if (!id || catalogDefinition[id]) throw new Error('Give the connection a name that is not one of the built-in connectors');
    const connectionKind = clean(kind) || 'mcp';
    if (!['mcp', 'api', 'cli', 'git'].includes(connectionKind)) throw new Error('kind must be mcp, api, cli, or git');
    if (connectionKind === 'git') return this.#saveGit(id, { title: title || name, description, repository, branch, token, knowledge });
    const references = await this.#storeEnv(id, env);
    let connection;
    if (connectionKind === 'api') {
      const endpoint = clean(baseUrl) || clean(baseUrlSnake);
      if (!/^https?:\/\/\S+$/i.test(endpoint) && !/^\$\{[A-Z][A-Z0-9_]*\}\S*$/.test(endpoint)) throw new Error('Base URL must start with http:// or https://');
      const authMode = clean(auth) || 'none';
      if (!['none', 'bearer', 'basic', 'oauth'].includes(authMode)) throw new Error('auth must be none, bearer, basic, or oauth');
      const secret = clean(token);
      if (secret) { const key = `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'C_$1')}_TOKEN`; await this.secretStore.set(this.ref(id, key), secret); references[key] = `\${${key}}`; }
      connection = { kind: 'api', base_url: endpoint.replace(/\/+$/, ''), auth: authMode, ...(Object.keys(references).length ? { env: references } : {}) };
    } else if (connectionKind === 'cli') {
      const executable = clean(command);
      if (!executable || /\s/.test(executable)) throw new Error('Give the command name only, for example git or gh');
      const extra = Array.isArray(args) ? args.map(String).filter(Boolean) : typeof args === 'string' && args.trim() ? args.trim().split(/\s+/) : [];
      connection = { kind: 'cli', command: executable, ...(extra.length ? { args: extra } : {}), ...(Object.keys(references).length ? { env: references } : {}) };
    } else {
      const mcp = normalizeMcp({ transport, url, command, args }, null);
      connection = { kind: 'mcp', transport: mcp.transport, ...(mcp.transport === 'stdio' ? { command: mcp.command, args: mcp.args } : { url: mcp.url }), ...(Object.keys(references).length ? { env: references } : {}), enabled: true };
    }
    await this.workspace.setConnection(id, connection);
    const summary = clean(description);
    await this.workspace.updateOperations(current => ({ ...current, connectors: { ...(current.connectors || {}), [id]: { title: String(title || name || id).trim(), custom: true, ...(summary ? { description: summary.slice(0, 280) } : {}), updatedAt: now() } } }));
    return (await this.list()).find(card => card.id === id);
  }

  /**
   * A git repository (Bitbucket, GitHub or any HTTPS git host): saved as a `git` command-line
   * connection that carries the repository and branch, with the access token in the secret store.
   * A repository not marked as knowledge becomes the code-fix repository, but only when
   * source_control does not already name one, so adding a second repo never takes over the first.
   */
  async #saveGit(id: string, { title, description, repository, branch, token, knowledge }: Pick<CustomInput, 'title' | 'description' | 'repository' | 'branch' | 'token' | 'knowledge'>) {
    const raw = clean(repository).replace(/\/+$/, '');
    let parsed; try { parsed = new URL(raw); } catch { parsed = null; }
    if (!parsed || parsed.protocol !== 'https:') throw new Error('Repository link must be an HTTPS URL, for example https://bitbucket.org/acme/data-platform');
    if (parsed.username || parsed.password) throw new Error('Put the token in the access token field, not in the repository link');
    const refName = clean(branch) || 'main';
    if (!/^[\w./-]+$/.test(refName) || refName.includes('..')) throw new Error('Branch must be a branch name, for example main');
    const references: StringRecord = {};
    const secret = clean(token);
    const key = `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'C_$1')}_TOKEN`;
    if (secret) { await this.secretStore.set(this.ref(id, key), secret); references[key] = `\${${key}}`; }
    const connection = { kind: 'cli', command: 'git', repository: raw, branch: refName, ...(Object.keys(references).length ? { env: references } : {}) };
    await this.workspace.setConnection(id, connection);
    const platform = /(^|\.)bitbucket\./i.test(parsed.hostname) ? 'bitbucket' : /(^|\.)github\./i.test(parsed.hostname) ? 'github' : 'git';
    const summary = clean(description);
    await this.workspace.updateOperations(current => {
      const next = { ...current, connectors: { ...(current.connectors || {}), [id]: { title: String(title || id).trim(), custom: true, knowledge: Boolean(knowledge), ...(summary ? { description: summary.slice(0, 280) } : {}), updatedAt: now() } } };
      if (!knowledge && !clean(current.source_control?.connection)) next.source_control = { ...(current.source_control || {}), platform, connection: id, repository: raw, default_branch: refName };
      return next;
    });
    return (await this.list()).find(card => card.id === id);
  }

  async remove(id: string) {
    const before = (await this.workspace.readOperations()).connections?.[id];
    const removed = await this.workspace.removeConnection(id);
    await this.workspace.updateOperations(current => {
      const connectors = { ...(current.connectors || {}) }; delete connectors[id];
      const next = { ...current, connectors };
      // A removed code repository must not stay named as source_control's connection (validation rejects a dangling name).
      if (current.source_control?.connection === id) next.source_control = { ...current.source_control, connection: '' };
      return next;
    });
    const stored = new Set(await this.#secretsSet(id));
    for (const value of Object.values(before?.env || {})) { const match = /^\$\{([A-Z][A-Z0-9_]*)\}$/.exec(String(value)); if (match) stored.add(match[1]); }
    for (const env of stored) await this.secretStore.delete(this.ref(id, env)).catch(() => {});
    const def = connectorDefinition(id);
    if (def?.managedProfile && this.connectionService) {
      const profileId = this.profileId(def.managedProfile.provider);
      if (this.projectId && this.grants) await this.grants.revoke(this.projectId, 'connection', profileId).catch(error => { if ((error as {statusCode?:number}).statusCode !== 404) throw error; });
      await this.connectionService.delete(profileId);
    }
    return removed;
  }

  /** Test the data-page client where one exists; MCP-only connectors report what the agent would launch. */
  async test(id: string) {
    const def = connectorDefinition(id);
    if (def?.managedProfile && this.connectionService) {
      const provider = def.managedProfile.provider;
      const profile = await this.connectionService.getDefault?.(provider, this.projectId || undefined).catch(() => null);
      if (profile) { const tested = await this.connectionService.test(profile.id).catch(error => ({ lastTest: { status: 'failed', message: (error as Error).message } })); return { id, status: tested.lastTest?.status || 'failed', message: tested.lastTest?.message || 'Connection test did not run', testedAt: now() }; }
      const status = (await this.connectionService.providerStatuses?.(this.projectId || undefined).catch(() => []) || []).find(item => item.id === provider);
      if (status?.configured) return { id, status: status.ready ? 'connected' : 'failed', message: status.ready ? 'Connected through the deployment environment. Save the form to give the agent an MCP connection too.' : status.reason || 'The deployment connection is not ready', testedAt: now() };
    }
    const connections = (await this.workspace.readOperations()).connections || {};
    const connection = connections[id];
    if (!connection && id === 'email') {
      const envSmtp = smtpFromEnvironment(this.env);
      if (envSmtp) return this.#testSmtp(id, envSmtp, 'from the environment (SMTP_HOST)');
    }
    if (!connection) return { id, status: 'failed', message: 'Not connected', testedAt: now() };
    if (connection.kind === 'api') {
      if (!connection.base_url || /\$\{/.test(String(connection.base_url))) return { id, status: 'configured', message: `The agent calls ${connection.base_url || 'this API'} with credentials from its environment.`, testedAt: now() };
      try { const response = await fetch(connection.base_url, { method: 'GET', signal: AbortSignal.timeout(5000), redirect: 'manual' }); return { id, status: response.status < 500 ? 'connected' : 'failed', message: response.status < 500 ? `${connection.base_url} is reachable (HTTP ${response.status}).` : `${connection.base_url} answered HTTP ${response.status}.`, testedAt: now() }; }
      catch (error) { const detail = error as { cause?: { message?: unknown }; message?: unknown } | null; return { id, status: 'failed', message: `${connection.base_url} did not answer: ${String(detail?.cause?.message || detail?.message || error).slice(0, 160)}`, testedAt: now() }; }
    }
    if (connection.kind === 'smtp') {
      const settings = (await this.workspace.readOperations()).connectors?.[id]?.settings || {};
      if (settings.server) return this.#testSmtp(id, settings, 'from the saved connector');
      const envSmtp = smtpFromEnvironment(this.env);
      if (envSmtp) return this.#testSmtp(id, envSmtp, 'from the environment (SMTP_HOST)');
      return { id, status: 'failed', message: 'No mail server: save one in the connector or set SMTP_HOST in the environment.', testedAt: now() };
    }
    if (connection.kind === 'cli') {
      const { execFileSync } = await import('node:child_process');
      try { const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', [String(connection.command || '')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0]; return { id, status: 'connected', message: `${connection.command} is installed (${found}).`, testedAt: now() }; }
      catch { return { id, status: 'failed', message: `${connection.command || 'The command'} was not found on this machine.`, testedAt: now() }; }
    }
    const fromStore = Object.values(connection.env || {}).filter(value => /^\$\{/.test(String(value))).length;
    return { id, status: 'configured', message: `The agent will start ${connection.command ? `${connection.command} ${(connection.args || []).join(' ')}` : connection.url}${fromStore ? ` with ${fromStore} variable${fromStore === 1 ? '' : 's'} from the secret store` : ''}.`, testedAt: now() };
  }

  /** A real connection to the mail server, so an unreachable relay shows on the Connectors page instead of in a failed task. */
  async #testSmtp(id: string, settings: Record<string, unknown>, origin: string) {
    const host = settings.server; const security = String(settings.security || 'starttls').toLowerCase();
    const port = Number(settings.port) || (security === 'ssl' ? 465 : security === 'none' ? 25 : 587);
    const reached = await probeSmtp(host as string, port, security);
    return reached
      ? { id, status: 'failed', message: `${host}:${port} (${origin}) ${reached}.`, testedAt: now() }
      : { id, status: 'connected', message: `${host}:${port} (${origin}) answers. Credentials are checked on the first send.`, testedAt: now() };
  }

  /** Environment for every agent session: every connector secret and non-secret field as its env var. */
  async envForTasks(): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = {};
    const operations: OperationsDoc = await this.workspace.readOperations().catch(() => ({}));
    for (const [id, connection] of Object.entries(operations.connections || {})) {
      const def = connectorDefinition(id);
      const settings = operations.connectors?.[id]?.settings || {};
      if (def) for (const field of def.fields) if (field.env && settings[field.key]) env[field.env] = settings[field.key] as string;
      for (const value of Object.values(connection.env || {})) { const match = /^\$\{([A-Z][A-Z0-9_]*)\}$/.exec(String(value)); if (!match) continue; const stored = await this.secretStore.get(this.ref(id, match[1])).catch(() => undefined); if (stored !== undefined) env[match[1]] = stored; }
    }
    return env;
  }

  /** Env for a custom connection: `${VAR}` references are kept, literal values go to the secret store and become references. */
  async #storeEnv(id: string, env: StringRecord): Promise<StringRecord> {
    const references: StringRecord = {};
    for (const [rawKey, value] of Object.entries(env || {})) { const key = String(rawKey).trim(); if (!ENV_NAME.test(key)) throw new Error(`Environment variable name ${key} is invalid`); const text = clean(value); if (!text) continue; if (/^\$\{[A-Z][A-Z0-9_]*\}$/.test(text)) { references[key] = text; continue; } await this.secretStore.set(this.ref(id, key), text); references[key] = `\${${key}}`; }
    return references;
  }
  // Only drives the "credential set" badge, so a store that refuses the read (e.g. an IAM gap) counts
  // as not set instead of failing the whole Connectors list. Saving still surfaces the real error.
  async #secretsSet(id: string): Promise<string[]> { const def = connectorDefinition(id); const names = def ? def.secrets.map(secret => secret.env) : []; const set: string[] = []; for (const env of names) { const ref = this.ref(id, env); const present = this.secretStore.has ? await this.secretStore.has(ref).catch(() => false) : Boolean(await this.secretStore.get(ref).catch(() => undefined)); if (present) set.push(env); } return set; }
  async #secretValues(id: string, secrets: ConnectorSecret[]): Promise<Record<string, string | undefined>> { const values: Record<string, string | undefined> = {}; for (const secret of secrets) values[secret.key] = await this.secretStore.get(this.ref(id, secret.env)).catch(() => undefined); return values; }
}

function normalizeMcp(override: NonNullable<ConnectorInput['mcp']>, fallback: ConnectorMcp | null) {
  const transport = clean(override.transport) || fallback?.transport || 'stdio';
  if (transport === 'stdio') { const command = clean(override.command) || fallback?.command; if (!command) throw new Error('A command is required for a stdio MCP server'); const args = Array.isArray(override.args) ? override.args.map(String).filter(Boolean) : typeof override.args === 'string' && override.args.trim() ? override.args.trim().split(/\s+/) : (fallback?.args || []); return { transport, command, args }; }
  if (['http', 'sse'].includes(transport)) { const url = clean(override.url) || fallback?.url; if (!url) throw new Error('A URL is required for a remote MCP server'); return { transport, url }; }
  throw new Error('transport must be stdio, http, or sse');
}
function publicMcp(connection: WorkspaceConnection) { return connection.kind === 'mcp' ? { transport: connection.transport, command: connection.command || null, args: connection.args || [], url: connection.url || null, env: Object.keys(connection.env || {}), enabled: connection.enabled !== false } : { kind: connection.kind }; }
/**
 * The operations.yaml sections that name a connection, in the words a business user reads on the card.
 * A section "uses" a connection when any `connection:` key inside it (at any depth, e.g.
 * ticketing.app.sources[].connection or platforms[].connection) equals the connection name.
 */
const CONNECTION_USES = [
  { section: 'ticketing', label: 'Tickets', does: 'read and update tickets' },
  { section: 'platforms', label: 'Pipelines and data quality', does: 'read job runs and data-quality results' },
  { section: 'identity', label: 'Access requests', does: 'grant, remove and review access' },
  { section: 'documents', label: 'Documents and reports', does: 'publish documents and reports' },
  { section: 'communication', label: 'Mail', does: 'send mail' },
  { section: 'source_control', label: 'Code fixes', does: 'create branches, commit and open pull requests' },
  { section: 'knowledge', label: 'Knowledge', does: 'search approved knowledge' },
];
export function connectionUses(operations: OperationsDoc, name: string): Array<{ section: string; label: string }> {
  const refers = (value: unknown, depth = 0): boolean => {
    if (!value || typeof value !== 'object' || depth > 6) return false;
    if (Array.isArray(value)) return value.some(item => refers(item, depth + 1));
    return Object.entries(value).some(([key, child]) => (key === 'connection' && child === name) || refers(child, depth + 1));
  };
  return CONNECTION_USES.filter(use => refers(operations?.[use.section])).map(({ section, label }) => ({ section, label }));
}
function describeConnection(kind: string, uses: ConnectionUse[]) {
  const does = uses.map(use => CONNECTION_USES.find(item => item.section === use.section)?.does).filter(Boolean);
  const purpose = does.length ? ` to ${does.length > 1 ? `${does.slice(0, -1).join(', ')} and ${does[does.length - 1]}` : does[0]}` : '';
  const agent = process.env.OPS_AGENT_NAME || 'Sonic';
  if (kind === 'api') return `Plain HTTP API (REST), not an MCP server. ${agent} calls it directly${purpose}.`;
  if (kind === 'cli') return `Command-line tool on this machine. ${agent} runs it${purpose}.`;
  if (kind === 'native') return `Built-in capability of ${agent}'s runtime.`;
  return `MCP server ${agent} starts as a tool server${purpose}.`;
}
function connectionEndpoint(connection: WorkspaceConnection) {
  if (connection.kind === 'api') return String(connection.base_url || '');
  if (connection.kind === 'cli' && connection.repository) return `${connection.repository}${connection.branch ? ` (${connection.branch})` : ''}`;
  if (connection.kind === 'cli') return [connection.command, ...(connection.args || [])].filter(Boolean).join(' ');
  if (connection.kind === 'mcp') return connection.command ? [connection.command, ...(connection.args || [])].join(' ') : String(connection.url || '');
  return '';
}
function humanize(value: string) { return String(value || '').replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase()); }
/** Merge the connector's suggested operations.yaml fragments without clobbering what the user already wrote. */
function mergeOperations(current: OperationsDoc, fragment: OperationsDoc, { id, settings }: { id: string; settings: StringRecord }): OperationsDoc {
  const next = { ...current, connectors: { ...(current.connectors || {}), [id]: { settings, updatedAt: now() } } };
  if (fragment.platforms) { const existing = Array.isArray(current.platforms) ? current.platforms : []; for (const platform of fragment.platforms) if (!existing.some(item => item?.name === platform.name)) existing.push(platform); next.platforms = existing; }
  if (fragment.ticketing) { const ticketing = { ...(current.ticketing || {}) }; if (!clean(ticketing.platform)) Object.assign(ticketing, { platform: fragment.ticketing.platform, connection: fragment.ticketing.connection }); if (fragment.ticketing.scope) { const scope = (ticketing.scope || {}) as Record<string, unknown>; ticketing.scope = { ...scope, ...Object.fromEntries(Object.entries(fragment.ticketing.scope as Record<string, unknown>).filter(([, value]) => value && !clean(scope[String(value)]))) }; } next.ticketing = ticketing; }
  if (fragment.source_control) next.source_control = { ...(current.source_control || {}), ...fragment.source_control };
  // Mail: the connector owns the send connection, sender and internal domains; other communication settings stay.
  if (fragment.communication) next.communication = { ...(current.communication || {}), ...fragment.communication };
  return next;
}

/** The connectors of every project: `for(project)` is that project's ConnectorService. */
export class Connectors extends PerProject {
  workspaces!: ConnectorWorkspaceRegistry;
  constructor({ workspace, secretStore, connectionService, grants, env = process.env }: { workspace: unknown; secretStore: SecretStore; connectionService?: ConnectorStoreService; grants?: ConnectorGrants; env?: NodeJS.ProcessEnv }) {
    super(async (id: string) => new ConnectorService({ workspace: await this.workspaces.for(id), secretStore, connectionService, grants, env }));
    this.workspaces = asRegistry(workspace) as ConnectorWorkspaceRegistry;
  }
}
