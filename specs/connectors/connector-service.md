---
id: SPEC-connectors-02
title: Connector save, custom connections, remove, test, and agent environment
status: implemented
area: connectors
owners: []
code:
  - backend/src/connectors/connector-service.mjs
  - backend/src/api/connector-routes.mjs
  - backend/src/workspace/workspace.mjs
last_verified: 2026-10-03
---

# Connector save, custom connections, remove, test, and agent environment

## Purpose
One call connects a system for both consumers: the agent (an MCP/cli/smtp entry in operations.yaml with `${ENV}` references, rendered to `.mcp.json`, env injected per session) and the data pages (a managed connection profile). Admins can also add custom MCP, REST API and CLI connections.

## Scope
- In scope: `save`, `saveCustom`, `remove`, `test`, `envForTasks`, merge of suggested operations.yaml fragments.
- Out of scope: catalog content (SPEC-connectors-01), profile storage (SPEC-connectors-03), secret store (SPEC-connectors-04), SMTP (SPEC-connectors-06).

## Actors and permissions
Admin only on the backend for `PUT/POST/DELETE /api/connectors*` (`rbac.mjs:66`). `POST /api/connectors/:id/test` is a POST and therefore admin-only.

## Requirements
### Save a catalog connector
- **FR-1** `save(id, {settings, secrets, mcp, enabled})` SHALL reject an unknown id with status 404 (`Unknown connector: <id>`).
- **FR-2** Only fields whose `when` applies to the default-filled settings SHALL be validated and saved; a required missing field SHALL throw `<label> is required`; a value outside a field's `choices` SHALL throw `<label> must be one of: ...`.
- **FR-3** `host`, `instance` and `site` values SHALL be normalized with `normalizeOrigin` (HTTPS enforced, loopback HTTP allowed, no credentials; see SPEC-connectors-05).
- **FR-4** Secrets whose `when` does not apply SHALL be deleted from the secret store, so switching auth mode forgets the other credential.
- **FR-5** For each applicable secret, a non-blank supplied value SHALL be stored at ref `connectors/<id>/<ENV>`; a blank value SHALL keep the stored one; a required secret that is blank and not already stored SHALL throw `<label> is required`.
- **FR-6** The saved operations.yaml connection SHALL contain `${ENV}` references only (never values): for MCP `{kind:'mcp', transport, command, args | url, env, enabled}`; for GitHub `{kind:'cli', command:'gh', env, enabled}`; for entries without MCP/cli (email) `{kind, env, enabled}`. `env` SHALL include each applicable field with an `env` and a value, each applicable secret that is required or stored, and the connector's `mcp.extraEnv` literal values.
- **FR-7** A supplied `mcp` override SHALL replace the default launch: `stdio` needs a command; `http`/`sse` need a URL; any other transport SHALL throw `transport must be stdio, http, or sse`. Args may be a list or a whitespace-split string.
- **FR-8** `save` SHALL merge the connector's suggested operations.yaml fragment: `platforms[]` appended only if no platform of the same name exists; `ticketing.platform/connection` set only if `ticketing.platform` is empty; `source_control` and `communication` shallow-merged over existing; and `connectors.<id> = {settings, updatedAt}` always written.
- **FR-9** When the connector has a `managedProfile` and a connection service, `save` SHALL upsert profile `<provider>-nervecenter` (isDefault true, enabled per input) if every mapped credential is non-empty; errors matching `not available|Unsupported` SHALL be swallowed, others propagated.
- **FR-10** `save` SHALL return the refreshed card for the id.
### Custom connections
- **FR-11** `saveCustom` SHALL slug the name/title (lowercase, `-` separators, max 40) and reject an empty slug or a built-in id.
- **FR-12** `kind` SHALL be one of `mcp|api|cli`. `api` requires `baseUrl`/`base_url` matching `^https?://\S+$` or a `${VAR}` prefix; auth mode one of `none|bearer|basic|oauth` (default `none`); a supplied `token` is stored at `connectors/<id>/<ID>_TOKEN` and referenced as `${<ID>_TOKEN}`; trailing `/` is stripped. `cli` requires a command without whitespace; args list or string. `mcp` follows FR-7 with no fallback.
- **FR-13** Custom `env` entries SHALL have names matching `^[A-Z][A-Z0-9_]{1,63}$`; literal values go to the secret store and are replaced by `${NAME}`; values already of the form `${NAME}` are kept verbatim; blank values are skipped.
- **FR-14** `saveCustom` SHALL record `connectors.<id> = {title, custom:true, description<=280, updatedAt}`.
### Remove
- **FR-15** `remove(id)` SHALL delete the connection and its `connectors.<id>` entry, delete every secret at `connectors/<id>/<ENV>` for catalog secret names and for each `${VAR}` in the connection's env, and for built-in connectors with a managed profile delete profile `<provider>-nervecenter`.
### Test
- **FR-16** `test(id)` SHALL return `{id, status, message, testedAt}`. For connectors with a managed profile and a default profile it SHALL run the profile test and return its `lastTest`; if only deployment env is configured it SHALL report `connected`/`failed` from provider status.
- **FR-17** For custom/other connections: unknown id -> `failed 'Not connected'`; `api` with a literal URL -> GET with 5 s timeout, `redirect:'manual'`, `connected` when HTTP < 500; `api` whose URL contains `${` -> `configured`; `cli` -> `which`/`where` lookup; `smtp` -> SPEC-connectors-06; `mcp` -> `configured` with a description of what would be launched and how many variables come from the secret store (never launches the server).
### Agent environment
- **FR-18** `envForTasks()` SHALL return, for every connection in operations.yaml: each catalog field env var with its saved setting, and each `${VAR}` in the connection env resolved from the secret store (missing secrets omitted; store errors swallowed). It SHALL NOT filter on `enabled`.

## Scenarios
### S1 Jira save end to end
- **Given** empty workspace **When** `save('atlassian', {settings:{site:'company.atlassian.net', email, project}, secrets:{apiToken}})` **Then** site becomes `https://company.atlassian.net`, operations.yaml has `JIRA_API_TOKEN: ${JIRA_API_TOKEN}` and no token value, `.mcp.json` mirrors it, `ticketing.platform = jira`, profile `jira-nervecenter` has the token, `envForTasks()` returns the three Jira vars.
### S2 Missing pieces
- **When** saving without email **Then** `Account email is required`; without token on first save **Then** `API token is required`.
### S3 Re-save keeps secret, MCP override
- **When** re-saved with blank secret and `mcp:{transport:'http', url}` **Then** card shows transport `http` and the token still resolves.
### S4 Databricks auth switch
- **Given** saved as person (PAT) **When** saved as service principal **Then** `DATABRICKS_TOKEN` is deleted from the store and absent from `envForTasks()`; missing clientId/secret and bad `authMode` are rejected.
### S5 GitHub
- **When** saved **Then** connection is `{kind:'cli', command:'gh', env:{GITHUB_TOKEN}, enabled:true}`, `source_control` seeded, token not in operations.yaml.
### S6 Custom API/CLI/MCP
- **When** `saveCustom({kind:'api', title:'HR directory', baseUrl:'https://hr.example.com/api/', auth:'bearer', token})` **Then** id `hr-directory`, base_url without trailing slash, env `HR_DIRECTORY_TOKEN`, secret in store, none in the YAML file; `ftp://` -> `Base URL`, `rm -rf /` -> `command name only`, kind `soap` -> `kind must be`.
### S7 Remove
- **When** removing a custom connection **Then** its secrets are gone from `envForTasks()` and the store; removing `atlassian` also removes profile `jira-nervecenter`.
### S8 Test of api/cli
- **Then** a reachable local API and `git` report `connected`; an unreachable URL reports `failed`.

## Interfaces
- HTTP: `GET /api/connectors`; `PUT /api/connectors/:id` (body `{settings, secrets, mcp?, enabled?}`, 200 card); `POST /api/connectors/custom` (201 card); `DELETE /api/connectors/:id` (200 `{id, deleted}`); `POST /api/connectors/:id/test` (200 result). Errors: thrown `Error` -> 400 `{error}`; unknown connector -> 404.
- Data: operations.yaml `connections`, `connectors`; `.mcp.json` rendered by `workspace.setConnection`; secret refs `connectors/<id>/<ENV>`; profile id `<provider>-nervecenter`.
- `workspace.setConnection` validates MCP renderability and kind; `workspace.validate` flags literal values under secret-looking keys.

## Non-functional constraints
- Secret values SHALL NOT appear in operations.yaml, `.mcp.json`, API responses or card objects (verified by tests with `JSON.stringify(operations).includes(secret) === false`).
- Writes to operations.yaml go through `workspace.updateOperations` (serialized).
- Probe timeouts: api test 5 s.

## Known gaps / deviations
- `mergeOperations` ticketing scope filter indexes `ticketing.scope?.[value]` instead of `[key]` (`connector-service.mjs:282`), so existing scope values are always overwritten on re-save of Jira.
- Re-saving does not update an existing `platforms[]` entry of the same name; changing the Databricks host leaves the old workspace in `platforms`. `ticketing.connection` is not updated if `ticketing.platform` is already set.
- `remove` does not undo the seeded `ticketing`, `platforms`, `source_control`, `communication` sections or `knowledge.connection`; they dangle and may fail `workspace.validate` (`references unknown connection`).
- `remove` of a managed profile deletes the profile but not its secret `connections/<profile-id>/credentials` (see SPEC-connectors-03 gap).
- `api` custom base URLs are validated by regex only; plain HTTP to non-loopback hosts is accepted (contradicts the HTTPS-only rule in SPEC-connectors-05), and `test` will fetch any admin-supplied URL. MCP `url` is not validated at all. Backend accepts `auth: basic|oauth` and `bearer` with no token; the UI offers only `none|bearer`.
- Saving a custom connection with an existing slug silently overwrites it.
- `envForTasks` injects secrets for connections with `enabled:false`.
- Managed profile credentials for Snowflake are always `authType:'password'` from the connector form (key-pair only via `/api/connections`).
- Tests use a fake connection service; real `ConnectionService` interplay is untested here.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/connectors/connector-service.mjs:77` | none |
| FR-2 | `connector-service.mjs:80-88` | `backend/tests/connectors.test.mjs:26,71` |
| FR-3 | `connector-service.mjs:89` | `backend/tests/connectors.test.mjs:26` (https prefix) |
| FR-4 | `connector-service.mjs:92-93` | `backend/tests/connectors.test.mjs:71` |
| FR-5 | `connector-service.mjs:94-95` | `backend/tests/connectors.test.mjs:26` |
| FR-6 | `connector-service.mjs:98-102` | `backend/tests/connectors.test.mjs:26,58,98` |
| FR-7 | `connector-service.mjs:233-238` | `backend/tests/connectors.test.mjs:26` (http override); invalid transport: none |
| FR-8 | `connector-service.mjs:104,279-287` | `backend/tests/connectors.test.mjs:26,58` (scope overwrite untested) |
| FR-9 | `connector-service.mjs:106-110` | `backend/tests/connectors.test.mjs:26,71` |
| FR-10 | `connector-service.mjs:111` | `backend/tests/connectors.test.mjs:26` |
| FR-11 | `connector-service.mjs:122` | `backend/tests/connectors.test.mjs:26` |
| FR-12 | `connector-service.mjs:123-143` | `backend/tests/connector-uses.test.mjs:61` |
| FR-13 | `connector-service.mjs:224-228` | `backend/tests/connectors.test.mjs:26` |
| FR-14 | `connector-service.mjs:145-146` | `backend/tests/connector-uses.test.mjs:61` |
| FR-15 | `connector-service.mjs:150-160` | `backend/tests/connectors.test.mjs:26`; `connector-uses.test.mjs:61` |
| FR-16 | `connector-service.mjs:163-171` | none for the real profile path (fake only) |
| FR-17 | `connector-service.mjs:172-197` | `backend/tests/connectors.test.mjs:118,140` |
| FR-18 | `connector-service.mjs:211-221` | `backend/tests/connectors.test.mjs:26,58,71,98` |

## Open questions
- Should removal also revert seeded operations sections?
