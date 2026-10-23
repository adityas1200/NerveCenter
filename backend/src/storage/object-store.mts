import { config } from '../config.mjs';

export interface ObjectMetadata {
  size: number;
  etag: string | null;
}

export interface ObjectStore {
  readonly location: string;
  list(prefix: string): Promise<Map<string, ObjectMetadata>>;
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void>;
  delete(key: string): Promise<void>;
}

interface S3ObjectStoreOptions {
  bucket?: string;
  region?: string;
  client?: import('@aws-sdk/client-s3').S3Client;
}

interface DatabricksAuth {
  header(): Promise<string>;
  host: string;
}

interface DatabricksRequestOptions {
  query?: Record<string, string | undefined>;
  raw?: boolean;
  body?: Buffer | Uint8Array | string;
  headers?: Record<string, string>;
  allow?: number[];
}

type DatabricksRequest = (
  auth: DatabricksAuth,
  method: string,
  pathname: string,
  options?: DatabricksRequestOptions,
) => Promise<Response | { contents?: DatabricksEntry[]; next_page_token?: string }>;

interface DatabricksEntry {
  path?: string;
  is_directory?: boolean;
  file_size?: number;
  last_modified?: number | string;
}

interface DatabricksVolumeStoreOptions {
  root?: string;
  auth?: DatabricksAuth;
  request?: DatabricksRequest;
}

export class S3ObjectStore implements ObjectStore {
  private bucket?: string;
  private region?: string;
  private client?: import('@aws-sdk/client-s3').S3Client;

  constructor({ bucket, region, client }: S3ObjectStoreOptions = {}) { Object.assign(this, { bucket, region, client }); }
  get location(): string { return `s3://${this.bucket}`; }
  async #sdk() { return import('@aws-sdk/client-s3'); }
  async #client(): Promise<import('@aws-sdk/client-s3').S3Client> {
    if (!this.client) {
      const { S3Client } = await this.#sdk();
      this.client = new S3Client(this.region ? { region: this.region } : {});
    }
    return this.client;
  }

  async list(prefix: string): Promise<Map<string, ObjectMetadata>> {
    const { ListObjectsV2Command } = await this.#sdk();
    const client = await this.#client();
    const items = new Map<string, ObjectMetadata>();
    let token: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const object of page.Contents || []) {
        items.set(object.Key!, { size: Number(object.Size || 0), etag: object.ETag || null });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return items;
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await this.#sdk();
    const response = await (await this.#client()).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await response.Body!.transformToByteArray());
  }

  async put(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void> {
    const { PutObjectCommand } = await this.#sdk();
    await (await this.#client()).send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await this.#sdk();
    await (await this.#client()).send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

const encodePath = (value: string): string => value.split('/').map(encodeURIComponent).join('/');

/** A Unity Catalog volume (/Volumes/<catalog>/<schema>/<volume>) through the Files API. */
export class DatabricksVolumeStore implements ObjectStore {
  private readonly root: string;
  private auth?: DatabricksAuth;
  private request?: DatabricksRequest;

  constructor({ root, auth, request }: DatabricksVolumeStoreOptions = {}) {
    this.root = String(root || '').replace(/\/+$/, '');
    if (!/^\/Volumes\/[^/]+\/[^/]+\/[^/]+/.test(this.root)) throw new Error('OPS_VOLUME_PATH must look like /Volumes/<catalog>/<schema>/<volume>');
    Object.assign(this, { auth, request });
  }
  get location(): string { return this.root; }
  async #call(method: string, pathname: string, options?: DatabricksRequestOptions): Promise<Response | { contents?: DatabricksEntry[]; next_page_token?: string }> {
    if (!this.request) {
      const app = await import('../platform/databricks-app.mjs');
      this.auth ??= app.appDatabricksAuth();
      this.request = app.databricksRequest as DatabricksRequest;
    }
    return this.request!(this.auth!, method, pathname, options);
  }
  #path(key: string): string { return `${this.root}/${key.replace(/^\/+/, '')}`; }

  /** Walks the directory tree under the prefix; the Files API lists one level per call. */
  async list(prefix: string): Promise<Map<string, ObjectMetadata>> {
    const items = new Map<string, ObjectMetadata>();
    const base = prefix.replace(/\/+$/, '');
    const walk = async (directory: string): Promise<void> => {
      let pageToken: string | undefined;
      do {
        const response = await this.#call('GET', `/api/2.0/fs/directories${encodePath(this.#path(directory))}`, { query: { page_token: pageToken }, allow: [404] });
        if (response instanceof Response) return;
        for (const entry of response.contents || []) {
          const key = String(entry.path || '').slice(this.root.length + 1);
          if (entry.is_directory) await walk(key);
          else items.set(key, { size: Number(entry.file_size || 0), etag: entry.last_modified ? String(entry.last_modified) : null });
        }
        pageToken = response.next_page_token;
      } while (pageToken);
    };
    await walk(base);
    return items;
  }
  async get(key: string): Promise<Buffer> {
    const response = await this.#call('GET', `/api/2.0/fs/files${encodePath(this.#path(key))}`, { raw: true });
    return Buffer.from(await (response as Response).arrayBuffer());
  }
  // Upload creates missing parent directories.
  async put(key: string, body: Buffer | Uint8Array | string, _contentType?: string): Promise<void> {
    await this.#call('PUT', `/api/2.0/fs/files${encodePath(this.#path(key))}`, { query: { overwrite: 'true' }, body, headers: { 'content-type': 'application/octet-stream' }, raw: true });
  }
  async delete(key: string): Promise<void> {
    await this.#call('DELETE', `/api/2.0/fs/files${encodePath(this.#path(key))}`, { raw: true, allow: [404] });
  }
}

/** From config: null when nothing is configured (local development keeps the workspace on disk only). */
export function createObjectStore(): ObjectStore | null {
  if (config.objectStore === 'volume') return config.volumePath ? new DatabricksVolumeStore({ root: config.volumePath }) : null;
  if (config.objectStore === 's3') return config.s3Bucket ? new S3ObjectStore({ bucket: config.s3Bucket, region: config.awsRegion || undefined }) : null;
  throw new Error('OPS_OBJECT_STORE must be s3 or volume');
}
