import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { RUNTIME_DIR, config } from '../config.mjs';

export interface SecretStore {
  set(ref: string, value: string): Promise<boolean>;
  get(ref: string): Promise<string | undefined>;
  has(ref: string): Promise<boolean>;
  delete(ref: string): Promise<boolean>;
  status(ref: string): Promise<{ ref: string; present: boolean }>;
}

interface SecretQueryPool {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}

interface SecretStoreOptions {
  key?: string;
  pool?: SecretQueryPool;
  aws?: SecretStore;
}

interface SecretFileDocument {
  [ref: string]: string;
}

function errorName(error: unknown): unknown {
  if (typeof error === 'object' && error !== null && 'name' in error) return error.name;
  return undefined;
}

class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async set(ref: string, value: string): Promise<boolean> {
    if (!ref || typeof ref !== 'string') throw new Error('secret ref is required');
    if (typeof value !== 'string' || !value) throw new Error('secret value is required');
    this.values.set(ref, value);
    return true;
  }
  async get(ref: string): Promise<string | undefined> { return this.values.get(ref); }
  async has(ref: string): Promise<boolean> { return this.values.has(ref); }
  async delete(ref: string): Promise<boolean> { return this.values.delete(ref); }
  async status(ref: string): Promise<{ ref: string; present: boolean }> { return { ref, present: await this.has(ref) }; }
}

class AwsSecretsManagerStore implements SecretStore {
  private readonly prefix: string;
  private readonly region: string | undefined;
  private client: import('@aws-sdk/client-secrets-manager').SecretsManagerClient | null = null;

  // Prefer the NerveCenter-scoped prefix; fall back to the shared dataverse AWS_SECRET_PREFIX,
  // then the legacy OPS_SECRET_PREFIX, then a safe default.
  constructor({ prefix = process.env.NC_SECRET_PREFIX || process.env.NERVECENTER_SECRET_PREFIX || process.env.AWS_SECRET_PREFIX || process.env.OPS_SECRET_PREFIX || 'nervecenter', region = config.awsRegion }: { prefix?: string; region?: string } = {}) {
    this.prefix = prefix.replace(/^\/+|\/+$/g, '');
    this.region = region || undefined;
  }

  // `aws:<name-or-arn>` is intentionally an explicit escape hatch for an
  // administrator-supplied Secrets Manager name. The UI never lists secrets;
  // it only asks AWS to resolve the exact name entered by the operator.
  private name(ref: string): string {
    const value = String(ref || '');
    return value.startsWith('aws:') ? value.slice(4) : `${this.prefix}/${value}`;
  }

  async #sdk(): Promise<import('@aws-sdk/client-secrets-manager').SecretsManagerClient> {
    if (this.client) return this.client;
    const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
    this.client = new SecretsManagerClient({ region: this.region });
    return this.client;
  }

  async get(ref: string): Promise<string | undefined> {
    const { GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
    try {
      const result = await (await this.#sdk()).send(new GetSecretValueCommand({ SecretId: this.name(ref) }));
      return result.SecretString;
    } catch (error) {
      if (errorName(error) === 'ResourceNotFoundException') return undefined;
      throw error;
    }
  }
  async has(ref: string): Promise<boolean> { return Boolean(await this.get(ref)); }
  async set(ref: string, value: string): Promise<boolean> {
    const { CreateSecretCommand, PutSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
    const client = await this.#sdk();
    try {
      await client.send(new PutSecretValueCommand({ SecretId: this.name(ref), SecretString: value }));
    } catch (error) {
      if (errorName(error) !== 'ResourceNotFoundException') throw error;
      await client.send(new CreateSecretCommand({ Name: this.name(ref), SecretString: value }));
    }
    return true;
  }
  async delete(ref: string): Promise<boolean> {
    const { DeleteSecretCommand } = await import('@aws-sdk/client-secrets-manager');
    try {
      await (await this.#sdk()).send(new DeleteSecretCommand({ SecretId: this.name(ref), ForceDeleteWithoutRecovery: true }));
      return true;
    } catch (error) {
      if (errorName(error) === 'ResourceNotFoundException') return false;
      throw error;
    }
  }
  async status(ref: string): Promise<{ ref: string; present: boolean }> { return { ref, present: await this.has(ref) }; }
}

/**
 * Local development store: one JSON file under the runtime directory so connector and connection
 * credentials survive a backend restart. Not for deployments; they use AWS Secrets Manager.
 */
export class FileSecretStore implements SecretStore {
  private readonly file: string;
  constructor(file = path.join(RUNTIME_DIR, 'secrets.json')) { this.file = file; }
  async #read(): Promise<SecretFileDocument> {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }
  }
  async #write(values: SecretFileDocument): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(values, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }
  async set(ref: string, value: string): Promise<boolean> {
    if (!ref || typeof ref !== 'string') throw new Error('secret ref is required');
    if (typeof value !== 'string' || !value) throw new Error('secret value is required');
    const values = await this.#read(); values[ref] = value; await this.#write(values); return true;
  }
  async get(ref: string): Promise<string | undefined> { return (await this.#read())[ref]; }
  async has(ref: string): Promise<boolean> { return Object.hasOwn(await this.#read(), ref); }
  async delete(ref: string): Promise<boolean> {
    const values = await this.#read();
    if (!Object.hasOwn(values, ref)) return false;
    delete values[ref]; await this.#write(values); return true;
  }
  async status(ref: string): Promise<{ ref: string; present: boolean }> { return { ref, present: await this.has(ref) }; }
}

/**
 * Connector and connection credentials encrypted into the deployment's own Postgres (AES-256-GCM,
 * one random IV per value), so the app needs no Secrets Manager write access. The key
 * (OPS_SECRET_ENCRYPTION_KEY) comes from .env.defaults or the host env; rotate it by re-saving the
 * connectors.
 */
export class PostgresSecretStore implements SecretStore {
  private readonly key: Buffer;
  private pool: SecretQueryPool | undefined;
  private ready: Promise<SecretQueryPool> | null = null;
  private aws: SecretStore | undefined;

  constructor({ key = config.secretEncryptionKey, pool, aws }: SecretStoreOptions = {}) {
    if (!key) throw new Error('OPS_SECRET_STORE=postgres requires OPS_SECRET_ENCRYPTION_KEY');
    this.key = createHash('sha256').update(String(key)).digest(); this.pool = pool; this.aws = aws;
  }
  async #db(): Promise<SecretQueryPool> {
    this.ready ??= (async () => {
      let resolvedPool: SecretQueryPool;
      if (this.pool) resolvedPool = this.pool;
      else {
        const { getPgPool } = await import('../storage/postgres.mjs');
        resolvedPool = await getPgPool();
        this.pool = resolvedPool;
      }
      return resolvedPool;
    })().catch(error => { this.ready = null; throw error; });
    return this.ready;
  }
  // `aws:<name>` refs name an existing Secrets Manager secret an operator chose in the UI; read it
  // from AWS (read-only) instead of the table so that option keeps working on this store.
  #external(ref: string): SecretStore | null {
    if (!String(ref || '').startsWith('aws:')) return null;
    this.aws ??= new AwsSecretsManagerStore();
    return this.aws;
  }
  #seal(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
  }
  #open(sealed: string): string {
    const [version, iv, tag, data] = String(sealed).split('.');
    if (version !== 'v1') throw new Error('Unknown secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
  async set(ref: string, value: string): Promise<boolean> {
    if (!ref || typeof ref !== 'string') throw new Error('secret ref is required');
    if (typeof value !== 'string' || !value) throw new Error('secret value is required');
    await (await this.#db()).query('INSERT INTO ops_secrets(ref, value) VALUES($1, $2) ON CONFLICT (ref) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [ref, this.#seal(value)]);
    return true;
  }
  async get(ref: string): Promise<string | undefined> {
    const external = this.#external(ref); if (external) return external.get(ref);
    const { rows } = await (await this.#db()).query<{ value: string }>('SELECT value FROM ops_secrets WHERE ref = $1', [ref]);
    return rows[0] ? this.#open(rows[0].value) : undefined;
  }
  async has(ref: string): Promise<boolean> {
    const external = this.#external(ref); if (external) return external.has(ref);
    const { rows } = await (await this.#db()).query('SELECT 1 FROM ops_secrets WHERE ref = $1', [ref]);
    return rows.length > 0;
  }
  async delete(ref: string): Promise<boolean> {
    const { rowCount } = await (await this.#db()).query('DELETE FROM ops_secrets WHERE ref = $1', [ref]);
    return (rowCount ?? 0) > 0;
  }
  async status(ref: string): Promise<{ ref: string; present: boolean }> { return { ref, present: await this.has(ref) }; }
}

export function createSecretStore(): SecretStore {
  if (config.secretStore === 'aws') return new AwsSecretsManagerStore();
  if (config.secretStore === 'postgres') return new PostgresSecretStore();
  if (config.secretStore === 'file') return new FileSecretStore();
  return new MemorySecretStore();
}
