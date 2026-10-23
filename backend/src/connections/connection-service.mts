import { randomUUID } from 'node:crypto';
import { config } from '../config.mjs';
import { normalizeOrigin } from '../lib/endpoint.mjs';
import { errorText } from '../lib/errors.mjs';
import { databricksFromConnection } from '../connectors/databricks/databricks-service.mjs';
import { ServiceNowService, normalizeServiceNowInstance } from '../connectors/servicenow/servicenow-service.mjs';
import { SnowflakeService } from '../connectors/snowflake/snowflake-service.mjs';
import { JiraService, normalizeJiraSite } from '../connectors/jira/jira-service.mjs';
import { httpError, now } from '../lib/util.mjs';
import type { ConnectionProfile, ConnectionProfilePersistence } from './connection-profile-store.mjs';
import type { SecretStore } from '../secrets/secret-store.mjs';
import type { ProjectGrant } from '../projects/project-store.mjs';

type ProviderId = 'databricks' | 'servicenow' | 'jira' | 'snowflake';
type ProviderField = { key: string; label: string; placeholder?: string; required: boolean; default?: string; choices?: Array<{ value: string; label: string }> };
type ProviderTemplate = { id: ProviderId; name: string; state: string; icon: string; description: string; fields: ProviderField[] };
type ConnectionConfig = Record<string, string>;
type Credentials = Record<string, string | undefined>;
type ConnectionInput = { id?: string; provider?: string; name?: string; config?: Record<string, unknown>; credentialSource?: string; secretName?: string; credentials?: Credentials; enabled?: boolean; isDefault?: boolean; projectAdminsMayGrant?: boolean };
type ProjectConnectionAccess = { list(): Promise<Array<{ id: string; name: string; kind: string }>>; listGrants(projectId: string, type: 'connection'): Promise<ProjectGrant[]>; putGrant(projectId: string, grant: Omit<ProjectGrant, 'projectId' | 'createdAt'>, actor?: { id: string }): Promise<ProjectGrant> };
type ConnectionInputProfile = Omit<ConnectionProfile, 'id' | 'provider'> & { id: string; provider: string; importedFromEnv?: boolean; projectAdminsMayGrant?: boolean };
type ConnectionResolve = { provider: string; source: 'managed' | 'deployment'; profile: ConnectionProfile | null; config: Record<string, string | undefined>; credentials: Credentials };
type EnvironmentCandidate = { config: Record<string, string | undefined>; credentials: Credentials };
type ProfileImportState = { get?(): Promise<{ providers?: string[] } | null | undefined>; set?(value: { providers: string[] }): Promise<unknown> };
type ConnectionTicketStore = { backfillConnection?(provider: string, id: string): Promise<unknown> };

const PROVIDERS: Record<string, ProviderTemplate> = {
  databricks: {
    id: 'databricks', name: 'Databricks', state: 'available', icon: 'databricks',
    description: 'Pipeline status, runs, clusters, lineage, RCA evidence, and governed retriggers. Authenticate with a personal access token or an OAuth service principal.',
    fields: [
      { key: 'host', label: 'Workspace URL', placeholder: 'https://adb-1234567890.1.azuredatabricks.net', required: true },
      { key: 'authMode', label: 'Authenticate as', required: false, default: 'pat', choices: [{ value: 'pat', label: 'A person (access token)' }, { value: 'service_principal', label: 'A service principal (OAuth)' }] },
    ],
  },
  servicenow: {
    id: 'servicenow', name: 'ServiceNow', state: 'available', icon: 'servicenow',
    description: 'Sync incidents into NerveCenter tickets and retrieve incident details.',
    fields: [{ key: 'instance', label: 'Instance URL', placeholder: 'https://company.service-now.com', required: true }],
  },
  jira: {
    id: 'jira', name: 'Jira', state: 'available', icon: 'atlassian',
    description: 'Jira issues in scope become tickets and tasks.',
    fields: [
      { key: 'site', label: 'Jira site URL', placeholder: 'https://company.atlassian.net', required: true },
      { key: 'email', label: 'Account email', placeholder: 'you@company.com', required: true },
      { key: 'project', label: 'Default project key', placeholder: 'DATAOPS', required: false },
    ],
  },
  snowflake: {
    id: 'snowflake', name: 'Snowflake', state: 'available', icon: 'snowflake',
    description: 'Use a Snowflake MCP server, or create a direct read-only profile with key-pair or password authentication.',
    fields: [
      { key: 'account', label: 'Account identifier', placeholder: 'org-account.region.cloud', required: true },
      { key: 'role', label: 'Role', placeholder: 'ANALYST', required: false },
      { key: 'warehouse', label: 'Warehouse', placeholder: 'COMPUTE_WH', required: false },
      { key: 'database', label: 'Database', placeholder: 'ANALYTICS', required: false },
      { key: 'schema', label: 'Schema', placeholder: 'PUBLIC', required: false },
    ],
  },
};

const cleanText = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const cleanConfig = (value?: Record<string, unknown>): ConnectionConfig => Object.fromEntries(Object.entries(value || {}).map(([key, field]) => [key, cleanText(field)]).filter(([, field]) => field)) as ConnectionConfig;
const redacted = (error: unknown) => errorText(error, 'Connection test failed');

export function providerTemplates() { return Object.values(PROVIDERS); }

/** Credentials of the deployment environment, as normal profile fields. Used once, to import `<provider>-env` (FR-32, FR-41). */
export function envCandidate(provider: string, env: NodeJS.ProcessEnv = process.env): EnvironmentCandidate | null {
  // A service principal in the environment wins over a personal access token: DATABRICKS_CLIENT_ID
  // and DATABRICKS_CLIENT_SECRET are the Databricks SDK's own names, so a host already set up for
  // the SDK needs no extra variables here.
  if (provider === 'databricks' && env.DATABRICKS_HOST && env.DATABRICKS_CLIENT_ID && env.DATABRICKS_CLIENT_SECRET) return { config: { host: env.DATABRICKS_HOST, authMode: 'service_principal' }, credentials: { clientId: env.DATABRICKS_CLIENT_ID, clientSecret: env.DATABRICKS_CLIENT_SECRET } };
  if (provider === 'databricks' && env.DATABRICKS_HOST && env.DATABRICKS_TOKEN) return { config: { host: env.DATABRICKS_HOST, authMode: 'pat' }, credentials: { token: env.DATABRICKS_TOKEN } };
  if (provider === 'servicenow' && (env.SERVICENOW_INSTANCE || env.OPS_SERVICENOW_INSTANCE) && env.SERVICENOW_USERNAME && env.SERVICENOW_PASSWORD) return { config: { instance: env.SERVICENOW_INSTANCE || env.OPS_SERVICENOW_INSTANCE }, credentials: { username: env.SERVICENOW_USERNAME, password: env.SERVICENOW_PASSWORD } };
  if (provider === 'snowflake' && env.SNOWFLAKE_ACCOUNT && env.SNOWFLAKE_USER && (env.SNOWFLAKE_PRIVATE_KEY || env.SNOWFLAKE_PASSWORD)) {
    const keyPair = Boolean(env.SNOWFLAKE_PRIVATE_KEY);
    return { config: { account: env.SNOWFLAKE_ACCOUNT, warehouse: env.SNOWFLAKE_WAREHOUSE, database: env.SNOWFLAKE_DATABASE, schema: env.SNOWFLAKE_SCHEMA, role: env.SNOWFLAKE_ROLE }, credentials: keyPair ? { authType: 'key_pair', username: env.SNOWFLAKE_USER, privateKey: env.SNOWFLAKE_PRIVATE_KEY, privateKeyPassphrase: env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE } : { authType: 'password', username: env.SNOWFLAKE_USER, password: env.SNOWFLAKE_PASSWORD } };
  }
  if (provider === 'snowflake' && env.SNOWFLAKE_ACCOUNT && env.SNOWFLAKE_TOKEN) return { config: { account: env.SNOWFLAKE_ACCOUNT, warehouse: env.SNOWFLAKE_WAREHOUSE, database: env.SNOWFLAKE_DATABASE, schema: env.SNOWFLAKE_SCHEMA, role: env.SNOWFLAKE_ROLE }, credentials: { authType: 'legacy_token', token: env.SNOWFLAKE_TOKEN, tokenType: env.SNOWFLAKE_TOKEN_TYPE || 'PROGRAMMATIC_ACCESS_TOKEN' } };
  return null;
}
export const ENV_PROFILE_PROVIDERS = ['databricks', 'servicenow', 'snowflake'];
export const envProfileId = (provider: string) => `${provider}-env`;

/**
 * Connection profiles are one library (admins add them once, FR-31); a project uses only the profiles granted to it
 * (FR-32). With a project store every provider read names its project: `getDefault(provider, projectId)` and
 * `resolve(provider, projectId)` consider the enabled profiles that project holds a grant of, and never the deployment
 * environment (that is imported once as the profile `<provider>-env`). Without a project store (a unit test of the
 * service alone) the library is one global list, as before projects.
 */
export class ConnectionService {
  store!: ConnectionProfilePersistence;
  secretStore!: SecretStore;
  projects!: ProjectConnectionAccess | null;
  env!: NodeJS.ProcessEnv;
  constructor({ store, secretStore, projects = null, env = process.env }: { store: ConnectionProfilePersistence; secretStore: SecretStore; projects?: ProjectConnectionAccess | null; env?: NodeJS.ProcessEnv }) { Object.assign(this, { store, secretStore, projects, env }); }

  #needProject(projectId?: string) {
    if (!projectId) throw httpError(500, 'A project is required to pick a connection');
    return String(projectId);
  }
  /** The grants of one project's connections: `[{ profile, grant }]` in grant order, profiles that still exist only. */
  async granted(projectId: string) {
    const grants = await this.projects!.listGrants(this.#needProject(projectId), 'connection').catch(() => []);
    const rows = [];
    for (const grant of grants) { const profile = await this.store.get(grant.resourceId); if (profile) rows.push({ profile, grant }); }
    return rows;
  }
  /** The projects (not Unrouted) that hold a grant of a connection: `[{ project, grant }]`. */
  async holders(profileId: string) {
    const found = [];
    for (const project of await this.projects!.list()) {
      if (project.kind !== 'normal') continue;
      const grant = (await this.projects!.listGrants(project.id, 'connection')).find(item => item.resourceId === profileId);
      if (grant) found.push({ project, grant });
    }
    return found;
  }

  /** `projectId` narrows the list to what the project may use, each profile carrying its grant; without one it is the whole library. */
  async list(projectId?: string) {
    if (this.projects && projectId) return Promise.all((await this.granted(projectId)).map(async ({ profile, grant }) => ({ ...this.publicProfile(profile), isDefault: Boolean(grant.isDefault), grant: { scope: grant.scope || {}, isDefault: Boolean(grant.isDefault) } })));
    return Promise.all((await this.store.list()).map(profile => this.publicProfile(profile)));
  }
  async get(id: string, projectId?: string) {
    const profile = await this.store.get(id); if (!profile) return null;
    if (this.projects && projectId) { const row = (await this.granted(projectId)).find(item => item.profile.id === id); if (!row) return null; return { ...this.publicProfile(profile), isDefault: Boolean(row.grant.isDefault), grant: { scope: row.grant.scope || {}, isDefault: Boolean(row.grant.isDefault) } }; }
    return this.publicProfile(profile);
  }
  async getRaw(id: string, projectId?: string) {
    const profile = await this.store.get(id); if (!profile) return null;
    if (this.projects && projectId && !(await this.granted(projectId)).some(item => item.profile.id === id)) return null;
    return profile;
  }
  async getDefault(provider: string, projectId?: string) {
    if (this.projects) {
      const usable = (await this.granted(this.#needProject(projectId))).filter(({ profile }) => profile.provider === provider && profile.enabled !== false);
      return (usable.find(({ grant }) => grant.isDefault) || usable[0])?.profile || null;
    }
    const profiles = (await this.store.list()).filter(item => item.provider === provider && item.enabled !== false);
    return profiles.find(item => item.isDefault) || profiles[0] || null;
  }

  /** The project's default profile for the provider with its credentials, or null: the environment is never a fallback for a project (FR-32). */
  async resolve(provider: string, projectId?: string): Promise<ConnectionResolve | null> {
    const profile = await this.getDefault(provider, projectId);
    if (profile) {
      const raw = await this.store.get(profile.id);
      return { provider, source: 'managed', profile, config: profile.config || {}, credentials: await this.credentials(raw) };
    }
    if (this.projects) return null;
    const fromEnv = envCandidate(provider, process.env);
    return fromEnv ? { provider, source: 'deployment', profile: null, ...fromEnv } : null;
  }

  async status(provider: string, projectId?: string) {
    let resolved;
    try { resolved = await this.resolve(provider, projectId); }
    catch (error) {
      const profile = await this.getDefault(provider, projectId).catch(() => null);
      return { provider, configured: Boolean(profile), ready: false, verified: false, source: profile ? 'managed' : null, profileId: profile?.id || null, lastTest: profile?.lastTest || null, reason: redacted(error) };
    }
    if (!resolved) return { provider, configured: false, ready: false, verified: false, source: null, reason: `Configure a ${PROVIDERS[provider]?.name || provider} connection` };
    const lastTest = resolved.profile?.lastTest || null;
    return {
      provider,
      configured: true,
      ready: true,
      verified: resolved.source === 'managed' ? lastTest?.status === 'connected' : null,
      source: resolved.source,
      profileId: resolved.profile?.id || null,
      lastTest,
    };
  }

  async providerStatuses(projectId?: string) {
    return Promise.all(Object.keys(PROVIDERS).map(async provider => ({ ...PROVIDERS[provider], ...(await this.status(provider, projectId)) })));
  }

  async #storedServiceNow(env: NodeJS.ProcessEnv) {
    const instance = env.SERVICENOW_INSTANCE || env.OPS_SERVICENOW_INSTANCE; if (!instance) return null;
    const stored = await this.secretStore?.get?.(env.OPS_SERVICENOW_SECRET_REF || 'integrations/servicenow/credential').catch(() => undefined);
    if (!stored) return null;
    let credentials: Credentials; try { credentials = JSON.parse(stored) as Credentials; } catch { return null; }
    return cleanText(credentials?.username) && cleanText(credentials?.password || credentials?.token) ? { config: { instance }, credentials: { username: credentials.username, password: credentials.password || credentials.token } } : null;
  }

  /** The service as one project sees it: the same calls, each answered from that project's grants. */
  forProject(projectId: string) { return new ProjectConnections(this, projectId); }
  /** The service pinned to one profile (a background import runs per granted connection, FR-28): that profile is the default of its provider. */
  pinned(profileId: string) { return new PinnedConnection(this, profileId); }

  /**
   * Deployment-environment credentials become the ordinary managed profile `<provider>-env` (FR-32, FR-41): created once,
   * granted to PILOT when that legacy project exists (the default for its provider when PILOT has none), refreshed from the environment while it stays an
   * env import, and never recreated after an admin deleted it. `ticketStore` re-stamps tickets imported before the profile existed.
   */
  async importEnvProfiles({ state = null, ticketStore = null, pilotId = 'pilot', env = this.env }: { state?: ProfileImportState | null; ticketStore?: ConnectionTicketStore | null; pilotId?: string | null; env?: NodeJS.ProcessEnv } = {}) {
    const done: Array<{ provider: string; id: string; created: boolean }> = []; const recorded = new Set((await state?.get?.())?.providers || []); const imported = new Set(recorded);
    for (const provider of ENV_PROFILE_PROVIDERS) {
      let candidate: EnvironmentCandidate | null = envCandidate(provider, env);
      // ServiceNow could also be set up as an instance in the environment with its credential in the secret store.
      if (!candidate && provider === 'servicenow') candidate = await this.#storedServiceNow(env);
      if (!candidate) continue;
      const id = envProfileId(provider); const existing = await this.store.get(id);
      const secretRef = existing?.secretRef || `connections/${id}/credentials`;
      if (!existing && imported.has(provider)) continue; // an admin deleted it: do not bring it back
      if (existing && !existing.importedFromEnv) { imported.add(provider); continue; } // an admin took it over
      if (existing) imported.add(provider);
      const config = cleanConfig(candidate.config);
      try {
        if (provider === 'databricks') config.host = normalizeOrigin(config.host, { label: 'Databricks workspace URL' });
        if (provider === 'servicenow') config.instance = normalizeServiceNowInstance(config.instance);
      } catch (error) { console.warn(`[connections] ${id} not imported: ${(error as Error).message}`); continue; }
      await this.secretStore.set(secretRef, JSON.stringify(candidate.credentials));
      const profile = { id, provider, name: `${PROVIDERS[provider].name} (deployment environment)`, config, credentialSource: 'direct', secretRef, enabled: existing?.enabled !== false, isDefault: false, importedFromEnv: true, createdAt: existing?.createdAt || now(), updatedAt: now(), lastTest: existing?.lastTest || null };
      await this.store.put(profile);
      if (!existing) {
        if (pilotId) {
          const pilotGrants = await this.projects!.listGrants(pilotId, 'connection').catch(() => []);
          const hasDefault = (await Promise.all(pilotGrants.filter(grant => grant.isDefault).map(grant => this.store.get(grant.resourceId)))).some(item => item?.provider === provider && item.enabled !== false);
          if (!pilotGrants.some(grant => grant.resourceId === id)) await this.projects!.putGrant(pilotId, { resourceType: 'connection', resourceId: id, scope: {}, isDefault: !hasDefault }, { id: 'migration' });
        }
        // Tickets that came through the environment's credentials before this profile existed belong to it.
        await ticketStore?.backfillConnection?.(provider, id);
        imported.add(provider); done.push({ provider, id, created: true });
      } else done.push({ provider, id, created: false });
    }
    if (state?.set && imported.size > recorded.size) await state.set({ providers: [...imported] });
    return done;
  }

  async save(input: ConnectionInput = {}, actor: unknown = null) {
    const provider = cleanText(input.provider).toLowerCase();
    const template = PROVIDERS[provider];
    if (!template) throw new Error('Unsupported connection provider');
    if (template.state !== 'available') throw new Error(`${template.name} is not available for connection yet`);
    const id = cleanText(input.id) || `${provider}-${randomUUID()}`;
    if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(id)) throw new Error('Connection ID is invalid');
    const name = cleanText(input.name) || template.name;
    const settings = cleanConfig(input.config);
    for (const field of template.fields) if (field.required && !settings[field.key]) throw new Error(`${field.label} is required`);
    if (provider === 'databricks') settings.host = normalizeOrigin(settings.host, { label: 'Databricks workspace URL' });
    if (provider === 'servicenow') settings.instance = normalizeServiceNowInstance(settings.instance);
    if (provider === 'jira') settings.site = normalizeJiraSite(settings.site);
    const credentialSource = input.credentialSource === 'secret-manager' ? 'secret-manager' : 'direct';
    const current = await this.store.get(id);
    const existingRef = current?.secretRef;
    let secretRef = existingRef || `connections/${id}/credentials`;
    if (credentialSource === 'secret-manager') {
      const secretName = cleanText(input.secretName);
      if (!secretName) throw new Error('Secrets Manager secret name is required');
      secretRef = `aws:${secretName.replace(/^aws:/, '')}`;
      if (!(await this.secretStore?.has?.(secretRef))) throw new Error('The supplied Secrets Manager secret was not found or cannot be read by this instance role');
    } else if (input.credentials && typeof input.credentials === 'object') {
      await this.#validateCredentials(provider, input.credentials);
      await this.secretStore.set(secretRef, JSON.stringify(input.credentials));
    } else if (!existingRef) {
      throw new Error('Credentials are required for a new connection');
    }
    const profile: ConnectionInputProfile = {
      id, provider, name, config: settings, credentialSource, secretRef, enabled: input.enabled !== false,
      // With projects the default is a property of a project's grant (FR-32); this flag only matters without a project store.
      isDefault: this.projects ? false : input.isDefault === true || !(await this.getDefault(provider)),
      // SPEC-projects-02 FR-15: whether project admins may grant this connection; only global admins reach this route.
      projectAdminsMayGrant: input.projectAdminsMayGrant === undefined ? Boolean(current?.projectAdminsMayGrant) : input.projectAdminsMayGrant === true,
      ...(current?.importedFromEnv ? { importedFromEnv: false } : {}),
      createdAt: current?.createdAt || now(), updatedAt: now(), lastTest: current?.lastTest || null,
    };
    if (profile.isDefault) await this.#clearDefault(provider, id);
    return this.publicProfile(await this.store.put(profile));
  }

  /** SPEC-projects-02 FR-15, SPEC-projects-03 FR-20: flip only the shareable flag (the admin console's "owners can grant" switch), without the config or the credentials. */
  async setProjectAdminsMayGrant(id: string, value: unknown, actor: unknown = null) {
    const current = await this.store.get(id);
    if (!current) throw httpError(404, 'Connection not found');
    const next = value === true;
    if (Boolean(current.projectAdminsMayGrant) === next) return this.publicProfile(current);
    const saved = await this.store.put({ ...current, projectAdminsMayGrant: next, updatedAt: now() });
    return this.publicProfile(saved);
  }

  /** Deleting a profile from the library fails (409) while any project holds a grant of it (FR-34). */
  async delete(id: string) {
    if (this.projects) {
      const holders = await this.holders(id);
      if (holders.length) throw httpError(409, `${id} is still granted to ${holders.map(holder => holder.project.name).join(', ')}. Remove those grants first.`);
    }
    return this.store.delete(id);
  }
  /** Make this profile the project's default for its provider: it applies to the project's grant (FR-32). */
  async setDefault(id: string, projectId?: string) {
    const profile = await this.store.get(id); if (!profile) throw new Error('Connection not found');
    if (this.projects) {
      const project = this.#needProject(projectId);
      const held = (await this.granted(project)).find(item => item.profile.id === id);
      if (!held) throw httpError(404, 'This connection is not granted to the project');
      if (profile.enabled === false) throw httpError(409, 'A disabled connection cannot be the default');
      for (const { profile: other, grant } of await this.granted(project)) if (other.provider === profile.provider && other.id !== id && grant.isDefault) await this.projects.putGrant(project, { resourceType: 'connection', resourceId: other.id, scope: grant.scope || {}, isDefault: false });
      await this.projects.putGrant(project, { resourceType: 'connection', resourceId: id, scope: held.grant.scope || {}, isDefault: true });
      return { ...this.publicProfile(profile), isDefault: true };
    }
    await this.#clearDefault(profile.provider, id);
    return this.publicProfile(await this.store.put({ ...profile, isDefault: true, updatedAt: now() }));
  }
  async test(id: string) {
    const profile = await this.store.get(id); if (!profile) throw new Error('Connection not found');
    if (PROVIDERS[profile.provider]?.state !== 'available') throw new Error('This connection is not available for testing yet');
    let result;
    try {
      if (profile.provider === 'databricks') {
        const service = databricksFromConnection({ config: profile.config, credentials: await this.credentials(profile) });
        const pipelines = await service.listPipelines({ limit: 1 });
        const as = service.auth.mode === 'service_principal' ? ` Signed in as service principal ${service.clientId}.` : '';
        result = { status: 'connected', message: `Connected.${as} ${pipelines.length ? 'Pipeline access verified.' : 'Workspace responded successfully.'}` };
      } else if (profile.provider === 'servicenow') {
        const service = new ServiceNowService({ secretStore: this.secretStore, instance: profile.config!.instance, secretRef: profile.secretRef });
        const status = await service.status({ verify: true });
        if (!status.ready) throw new Error(status.reason || 'ServiceNow verification failed');
        result = { status: 'connected', message: 'Connected. Incident access verified.' };
      } else if (profile.provider === 'snowflake') {
        const credentials = await this.credentials(profile);const service = new SnowflakeService({ ...profile.config, ...credentials });
        await service.queryRows({ statement: 'SELECT 1 AS connection_test' });result = { status: 'connected', message: 'Connected. Read-only SQL access verified.' };
      } else if (profile.provider === 'jira') {
        const service = new JiraService({ secretStore: this.secretStore, connectionService: this.pinned(profile.id) });
        const status = await service.status({ verify: true });
        if (!status.ready) throw new Error(status.reason || 'Jira verification failed');
        result = { status: 'connected', message: 'Connected. Issue search verified.' };
      }
    } catch (error) { result = { status: 'failed', message: redacted(error) }; }
    profile.lastTest = { ...result, testedAt: now() }; profile.updatedAt = now();
    await this.store.put(profile); return this.publicProfile(profile);
  }

  async credentials(profile: Pick<ConnectionProfile, 'secretRef'> | null): Promise<Credentials> {
    const raw = await this.secretStore?.get?.(profile?.secretRef as string);
    if (!raw) throw new Error('Connection credentials are unavailable');
    try { return JSON.parse(raw) as Credentials; } catch { return { token: raw }; }
  }
  publicProfile(profile: ConnectionProfile) {
    const { secretRef, importedFromEnv, ...safe } = profile;
    return { ...safe, credentialConfigured: Boolean(secretRef), secretSource: profile.credentialSource, secretRefLabel: profile.credentialSource === 'secret-manager' ? String(secretRef || '').replace(/^aws:/, '') : undefined };
  }
  async #clearDefault(provider: string, exceptId: string) { for (const profile of await this.store.list()) if (profile.provider === provider && profile.id !== exceptId && profile.isDefault) await this.store.put({ ...profile, isDefault: false, updatedAt: now() }); }
  async #validateCredentials(provider: string, credentials: Credentials) {
    if (provider === 'databricks') {
      const principal = cleanText(credentials.clientId) || cleanText(credentials.clientSecret);
      if (principal && !(cleanText(credentials.clientId) && cleanText(credentials.clientSecret))) throw new Error('A Databricks service principal needs both a client ID and a client secret');
      if (!principal && !cleanText(credentials.token || credentials.pat || credentials.accessToken)) throw new Error('Databricks needs a personal access token, or a service principal client ID and secret');
    }
    if (provider === 'servicenow' && (!cleanText(credentials.username) || !cleanText(credentials.password || credentials.token))) throw new Error('ServiceNow username and password are required');
    if (provider === 'jira' && !cleanText(credentials.apiToken || credentials.token)) throw new Error('Jira API token is required');
    if (provider === 'snowflake') {
      const authType = cleanText(credentials.authType).toLowerCase();
      if (!['key_pair', 'password'].includes(authType)) throw new Error('Snowflake authentication must use key pair or password');
      if (!cleanText(credentials.username)) throw new Error('Snowflake username is required');
      if (authType === 'key_pair' && !cleanText(credentials.privateKey)) throw new Error('Snowflake private key is required');
      if (authType === 'password' && !cleanText(credentials.password)) throw new Error('Snowflake password is required');
    }
  }
}

/** One project's view of the service: the methods the integrations call, answered from that project's grants. */
export class ProjectConnections {
  service!: ConnectionService; projectId!: string;
  constructor(service: ConnectionService, projectId: string) { Object.assign(this, { service, projectId }); }
  list() { return this.service.list(this.projectId); }
  get(id: string) { return this.service.get(id, this.projectId); }
  getRaw(id: string) { return this.service.getRaw(id, this.projectId); }
  getDefault(provider: string) { return this.service.getDefault(provider, this.projectId); }
  resolve(provider: string) { return this.service.resolve(provider, this.projectId); }
  status(provider: string) { return this.service.status(provider, this.projectId); }
  providerStatuses() { return this.service.providerStatuses(this.projectId); }
  credentials(profile: Pick<ConnectionProfile, 'secretRef'>) { return this.service.credentials(profile); }
  setDefault(id: string) { return this.service.setDefault(id, this.projectId); }
  test(id: string) { return this.service.test(id); }
  forProject(projectId: string) { return this.service.forProject(projectId); }
  pinned(profileId: string) { return this.service.pinned(profileId); }
}

/**
 * The service answering for one profile only, whatever the grants: a background import runs once per granted connection
 * and routes each item by the grants' filters afterwards, so it must read through exactly that connection.
 */
export class PinnedConnection {
  service!: ConnectionService; profileId!: string;
  constructor(service: ConnectionService, profileId: string) { Object.assign(this, { service, profileId }); }
  async #profile(provider?: string) { const profile = await this.service.store.get(this.profileId); return profile && profile.enabled !== false && (!provider || profile.provider === provider) ? profile : null; }
  async list() { const profile = await this.#profile(); return profile ? [this.service.publicProfile(profile)] : []; }
  async get(id: string) { return id === this.profileId ? ((await this.#profile()) ? this.service.get(id) : null) : null; }
  async getRaw(id: string) { return id === this.profileId ? this.#profile() : null; }
  getDefault(provider: string) { return this.#profile(provider); }
  async resolve(provider: string) { const profile = await this.#profile(provider); return profile ? { provider, source: 'managed' as const, profile, config: profile.config || {}, credentials: await this.service.credentials(profile) } : null; }
  async status(provider: string) {
    const profile = await this.#profile(provider);
    if (!profile) return { provider, configured: false, ready: false, verified: false, source: null, reason: `Configure a ${PROVIDERS[provider]?.name || provider} connection` };
    return { provider, configured: true, ready: true, verified: profile.lastTest?.status === 'connected', source: 'managed', profileId: profile.id, lastTest: profile.lastTest || null };
  }
  async providerStatuses() { return Promise.all(Object.keys(PROVIDERS).map(async provider => ({ ...PROVIDERS[provider], ...(await this.status(provider)) }))); }
  credentials(profile: Pick<ConnectionProfile, 'secretRef'>) { return this.service.credentials(profile); }
  test(id: string) { return this.service.test(id); }
}
