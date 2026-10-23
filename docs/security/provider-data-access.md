# Provider data access for boards and Sonic

Decision recorded during CR-01 on 2026-10-11: use read-only Databricks and Snowflake roles limited to approved views as the sensitive-data boundary.

## Access contract

Each connection profile used by a project must be granted to that project. The backend resolves provider reads through that grant; an ungranted project has no provider connection. A connector saved from one project's Connectors page creates its own managed profile and grant.

Before granting a profile, the data owner must configure its provider principal so it can query only approved views, with no direct access to the underlying sensitive tables or write privileges. Views should expose only columns and rows suitable for every member of the project. Use a separate provider principal where projects need different datasets. Recheck the provider grants when a view, role, or project grant changes.

Board SQL accepts a read-only `SELECT` and returns up to 200 rows. A published board makes its results available to project readers. Sonic's `query_data` path can send up to 50 returned rows to the agent and its task history. Therefore, any view reachable by either path must be safe for both audiences. The application cannot infer a dataset's sensitivity from its table name or verify the provider role's effective grants.

The connection test proves connectivity and a basic read; it does **not** certify that the role is read-only or limited to approved views. The data owner must verify those grants in the provider before enabling the profile for project use. CR-19 tracks that deployment check separately from the code regression tests.

## CR-19 deployment evidence

For each production connection profile and again after a role, view, or project grant changes, the data owner records the following in the deployment's restricted change record. Do not put credentials or query results in this repository.

| Field | Evidence to record |
|---|---|
| Deployment, project, profile | Environment and the exact project grant/profile identifiers |
| Provider identity | Databricks or Snowflake principal and effective role used by the profile |
| Allowed data | Approved view names and the owner who classified their columns and rows for this project |
| Effective privileges | Provider grant output or a link showing access to those views, no direct access to underlying sensitive tables, and no write privileges |
| Decision | Data owner, verification date, evidence link, and approved or rejected status |

An application connection test or a code review is not a substitute for the provider's effective-grant evidence. Do not enable a profile for project use until its deployment record is approved.
