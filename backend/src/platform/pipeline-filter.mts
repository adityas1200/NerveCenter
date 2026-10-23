// Which pipelines NerveCenter shows, per platform in operations.yaml:
//
//   platforms:
//     - name: commercial-databricks
//       type: databricks
//       connection: databricks
//       monitoring:
//         jobs: { include: [sales, nbrx], exclude: [_dev] }
//
// A term matches when the pipeline name contains it (case-insensitive) or equals the pipeline id.
// An empty include list keeps every job; exclude always wins. `monitoring.jobs` may still hold the
// plugin's older free-text description (a string); that is not a filter and keeps every job.
//
// A pipeline belongs to every platform whose name, connection or type equals `pipeline.platform`
// (the provider id, such as "databricks"). It is kept when any of those platforms keeps it, so two
// platform entries on one connection add up rather than cancel out. Pipelines no platform claims
// are kept: the filter narrows what a platform shows, it never hides a whole provider by accident.

export type Pipeline = {
  name?: string;
  pipelineId?: string | number;
  platform?: string;
};

type JobFilter = {
  include: string[];
  exclude: string[];
};

type PlatformDefinition = {
  name?: unknown;
  connection?: unknown;
  type?: unknown;
  monitoring?: unknown;
};

const terms = (value: unknown): string[] => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
  .map((item: unknown) => String(item ?? '').trim().toLowerCase())
  .filter(Boolean);

/** The job filter of one platform entry, or null when it has none. */
export function jobFilterOf(platform: unknown): JobFilter | null {
  const jobs = (platform as { monitoring?: { jobs?: unknown } } | null | undefined)?.monitoring?.jobs;
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) return null;
  const jobConfig = jobs as Record<string, unknown>;
  const include = terms(jobConfig.include); const exclude = terms(jobConfig.exclude);
  return include.length || exclude.length ? { include, exclude } : null;
}

function matches(pipeline: unknown, term: string): boolean {
  const value = pipeline as Pipeline | null | undefined;
  return String(value?.name ?? '').toLowerCase().includes(term) || String(value?.pipelineId ?? '').toLowerCase() === term;
}

/** True when this filter keeps the pipeline (a null filter keeps everything). */
export function keepsPipeline(pipeline: unknown, filter: JobFilter | null): boolean {
  if (!filter) return true;
  if (filter.exclude.some(term => matches(pipeline, term))) return false;
  return !filter.include.length || filter.include.some(term => matches(pipeline, term));
}

function platformsFor(pipeline: unknown, platforms: PlatformDefinition[]): PlatformDefinition[] {
  const value = pipeline as Pipeline | null | undefined;
  const key = String(value?.platform ?? '').trim().toLowerCase();
  if (!key) return [];
  return platforms.filter(platform => [platform?.name, platform?.connection, platform?.type].some(candidate => String(candidate ?? '').trim().toLowerCase() === key));
}

/**
 * Apply each platform's `monitoring.jobs` filter to a pipeline list.
 * @param pipelines Pipeline records.
 * @param platformsConfig operations.yaml `platforms`, or the whole operations object.
 */
export function filterPipelines(pipelines: unknown, platformsConfig: unknown): Pipeline[] {
  const list = (Array.isArray(pipelines) ? pipelines : []) as Pipeline[];
  const configured = (platformsConfig as { platforms?: unknown } | null | undefined)?.platforms;
  const configPlatforms = Array.isArray(platformsConfig)
    ? platformsConfig
    : Array.isArray(configured)
      ? configured
      : [];
  const platforms = configPlatforms as PlatformDefinition[];
  if (!platforms.some(jobFilterOf)) return list;
  return list.filter(pipeline => {
    const owners = platformsFor(pipeline, platforms);
    return !owners.length || owners.some(platform => keepsPipeline(pipeline, jobFilterOf(platform)));
  });
}
