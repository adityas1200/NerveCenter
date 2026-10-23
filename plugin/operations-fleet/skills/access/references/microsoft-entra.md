# Microsoft Entra access

Use object IDs for users, service principals, groups, and administrative units. Display names and email aliases may be non-unique.

Check:

- user type, account state, tenant, and object ID;
- group ID, group type, membership type, owners, and source of authority;
- direct membership, transitive membership, app-role assignment, directory role, and eligible or active privileged role;
- whether access is controlled by dynamic rules, on-premises synchronization, entitlement management, or another identity source;
- propagation delay and audit records.

Dynamic-group membership is calculated from attributes; members cannot be manually added or removed. Change the authoritative attribute or rule through the correct owner instead of attempting a direct membership write.

Privileged Identity Management, access packages, and administrative roles have distinct approval, activation, duration, and audit semantics. Confirm current official guidance before acting.

Official source: [Dynamic membership groups](https://learn.microsoft.com/en-us/entra/identity/users/groups-dynamic-membership).
