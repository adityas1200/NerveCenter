/** Display names for platform and system ids (pipeline platforms, result-table providers, connections, MCP servers). */
const PLATFORM_LABEL: Record<string, string> = {
  nervecenter: "NerveCenter", databricks: "Databricks", snowflake: "Snowflake", airflow: "Airflow", adf: "Data Factory",
  atlassian: "Jira", jira: "Jira", servicenow: "ServiceNow", github: "GitHub", bitbucket: "Bitbucket", sharepoint: "SharePoint", email: "Email",
};

/** The display name for a known id, or undefined so each caller keeps its own fallback. */
export const platformLabel = (id?: string | null): string | undefined => (id && Object.prototype.hasOwnProperty.call(PLATFORM_LABEL, id) ? PLATFORM_LABEL[id] : undefined);
