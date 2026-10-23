import { DataPlatformService, DATA_PLATFORM_PROVIDERS } from './data-platform.mjs';

/**
 * Resolves which data platform to read and hands back a ready DataPlatformService.
 *
 * The provider is not hard-coded anywhere: it comes from the connection an operator
 * configured in the UI, or from OPS_DATA_PLATFORM_PROVIDER when a deployment wants
 * to pin one. If nothing is configured, callers get a clear reason instead of a
 * stack trace, because "no connection yet" is the normal first-run state.
 */
export class DataPlatformCatalog {
  constructor({ connectionService, provider = process.env.OPS_DATA_PLATFORM_PROVIDER || '' } = {}) {
    this.connectionService = connectionService;
    this.pinnedProvider = String(provider || '').toLowerCase();
    if (this.pinnedProvider && !DATA_PLATFORM_PROVIDERS.includes(this.pinnedProvider)) {
      throw new Error(`OPS_DATA_PLATFORM_PROVIDER must be one of ${DATA_PLATFORM_PROVIDERS.join(', ')}`);
    }
  }

  /** Every provider with its readiness, so the UI can offer a real choice. */
  async status() {
    const providers = await Promise.all(DATA_PLATFORM_PROVIDERS.map(async provider => {
      const connection = await this.connectionService?.status?.(provider).catch(error => ({ ready: false, reason: String(error?.message || error) }));
      return {
        provider,
        ready: Boolean(connection?.ready),
        configured: Boolean(connection?.configured),
        verified: connection?.verified ?? null,
        source: connection?.source ?? null,
        reason: connection?.reason ?? null,
        capabilities: new DataPlatformService({ provider }).capabilities(),
      };
    }));
    const active = await this.activeProvider().catch(() => null);
    return { providers, active, pinned: this.pinnedProvider || null };
  }

  async activeProvider() {
    if (this.pinnedProvider) return this.pinnedProvider;
    for (const provider of DATA_PLATFORM_PROVIDERS) {
      const status = await this.connectionService?.status?.(provider).catch(() => null);
      if (status?.ready) return provider;
    }
    return null;
  }

  /** @returns {Promise<DataPlatformService>} */
  async service(requested) {
    const provider = String(requested || '').toLowerCase() || await this.activeProvider();
    if (!provider) throw new Error('Configure a Snowflake or Databricks connection to browse the data platform');
    if (!DATA_PLATFORM_PROVIDERS.includes(provider)) throw new Error(`Unsupported data platform: ${provider}`);
    const connection = await this.connectionService?.resolve?.(provider);
    if (!connection) throw new Error(`Configure a ${provider} connection to browse the data platform`);
    return new DataPlatformService({ provider, connection });
  }

  async listPipelines(args = {}) { return (await this.service(args.provider)).listPipelines(args); }
  async getPipeline(args = {}) { return (await this.service(args.provider)).getPipeline(args); }
  async listRuns(args = {}) { return (await this.service(args.provider)).listRuns(args); }
  async getRun(args = {}) { return (await this.service(args.provider)).getRun(args); }
  async listTables(args = {}) { return (await this.service(args.provider)).listTables(args); }
  async getTable(args = {}) { return (await this.service(args.provider)).getTable(args); }
  async getDdl(args = {}) { return (await this.service(args.provider)).getDdl(args); }
  async getLineage(args = {}) { return (await this.service(args.provider)).getLineage(args); }
}
