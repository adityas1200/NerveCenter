export const queryKeys = {
  overview: {
    all: ["overview"] as const,
    range: (from?: string | null, to?: string | null) => ["overview", { from: from ?? null, to: to ?? null }] as const,
    /** One Overview card's read for the chosen period; Work has no period. */
    group: (group: "tickets" | "pipelines" | "data-quality" | "agent", selection: unknown) => ["overview", group, selection] as const,
    work: ["overview", "work"] as const,
  },
  /** The caller's role in the open project. Not an `auth` key, so the project prefix keeps one answer per project. */
  access: ["access"] as const,
  /** `auth` keys are app-wide: the same in every project. */
  auth: {
    grantableNew: ["auth", "grantable-new"] as const,
    people: (query: string) => ["auth", "people", query] as const,
  },
  projectMembers: (projectId: string | null | undefined) => ["projects", "settings", projectId, "members"] as const,
  templates: {
    presets: ["templates", "presets"] as const,
  },
  dataPlatform: {
    tables: (search: string) => ["data-platform", "tables", { search }] as const,
  },
  notifications: {
    all: ["notifications"] as const,
  },
  monitor: {
    all: ["monitor"] as const,
    list: (filters?: object) => ["monitor", "list", filters ?? {}] as const,
    runs: (from?: string | null, to?: string | null) => ["monitor", "runs", { from: from ?? null, to: to ?? null }] as const,
  },
  dataQuality: {
    all: ["data-quality"] as const,
    providers: ["data-quality", "providers"] as const,
    config: ["data-quality", "config"] as const,
    monitor: (from?: string | null, to?: string | null) => ["data-quality", "monitor", { from: from ?? null, to: to ?? null }] as const,
  },
  pipelines: {
    all: ["pipelines"] as const,
    lists: () => ["pipelines", "list"] as const,
    list: (filters?: object) => ["pipelines", "list", filters ?? {}] as const,
    details: () => ["pipelines", "detail"] as const,
    detail: (id: string) => ["pipelines", "detail", id] as const,
    runs: (id: string) => ["pipelines", "detail", id, "runs"] as const,
  },
  tickets: {
    all: ["tickets"] as const,
    dashboard: ["tickets", "dashboard"] as const,
    lists: () => ["tickets", "list"] as const,
    list: (status: "active" | "closed" | "all" = "active") =>
      ["tickets", "list", { status }] as const,
    details: () => ["tickets", "detail"] as const,
    detail: (id: string) => ["tickets", "detail", id] as const,
    lineage: (id: string) => ["tickets", "detail", id, "lineage"] as const,
  },
  serviceNow: {
    all: ["integrations", "servicenow"] as const,
    status: ["integrations", "servicenow", "status"] as const,
    preview: (filters: object) => ["integrations", "servicenow", "preview", filters] as const,
  },
  jira: {
    all: ["integrations", "jira"] as const,
    status: ["integrations", "jira", "status"] as const,
    preview: (filters: object) => ["integrations", "jira", "preview", filters] as const,
  },
  connections: {
    all: ["connections"] as const,
    templates: ["connections", "templates"] as const,
    providers: ["connections", "providers"] as const,
  },
  meta: {
    all: ["meta"] as const,
  },
};
