# Databricks identity and access

Resolve account, workspace, Unity Catalog, and object-level entitlements separately.

Check:

- account and workspace identity IDs;
- source of identity: account console, SCIM, identity provider, or system group;
- workspace assignment and workspace entitlements;
- account and workspace admin roles;
- Unity Catalog metastore, catalog, schema, table, volume, external location, warehouse, job, and cluster privileges;
- group inheritance and effective permissions;
- whether the workspace uses identity federation;
- propagation and deactivation behavior.

A workspace assignment does not automatically prove data-object access, and data privileges do not prove workspace login rights. Verify the exact layer requested. Avoid adding users directly when the organization manages membership in an upstream identity provider.

Official sources:

- [Databricks identities](https://docs.databricks.com/aws/en/admin/users-groups/)
- [Workspace access](https://docs.databricks.com/aws/en/admin/users-groups/manage-users)
- [Unity Catalog privileges](https://docs.databricks.com/aws/en/data-governance/unity-catalog/manage-privileges/)
