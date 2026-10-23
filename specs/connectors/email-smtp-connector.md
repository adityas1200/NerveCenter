---
id: SPEC-connectors-06
title: Email (SMTP) connector
status: implemented
area: connectors
owners: []
code:
  - backend/src/connectors/connector-catalog.mjs
  - backend/src/connectors/connector-service.mjs
last_verified: 2026-10-03
---

# Email (SMTP) connector

## Purpose
Let the agent send approved emails, reports and extracts through the organisation's mail server. There is no MCP server: the agent's plugin sender (`send_email.py`) reads `communication.*` from operations.yaml and `SMTP_*` env vars. The connector writes both, can adopt a mail server from the deployment environment, and offers a real network test so an unreachable relay shows on the Connectors page, not in a failed task.

## Scope
- In scope: Email catalog entry, save, env-only mode, `smtpFromEnvironment`, `probeSmtp`, test.
- Out of scope: the sending itself and the email policy (in the plugin / policy sections), HTML rendering of emails.

## Actors and permissions
Admin only for save/remove/test (`rbac.mjs:66`).

## Requirements
- **FR-1** The connector SHALL have id `email`, name `Email (SMTP)`, `connectionKind: 'smtp'`, `hasMcpDefault: false`, used by Tasks and Routines.
- **FR-2** Fields: `server` (required, env `SMTP_HOST`), `port` (`SMTP_PORT`), `security` (`starttls|ssl|none`, env `SMTP_SECURITY`), `sender` (required), `domains` (optional). Secrets: `username` (`SMTP_USERNAME`), `password` (`SMTP_PASSWORD`), both optional.
- **FR-3** `save('email', ...)` SHALL store the connection as `{kind:'smtp', env, enabled}` (no MCP entry in `.mcp.json`), where `env` references only fields that have a value and secrets that are stored; secrets not supplied SHALL NOT be required or referenced.
- **FR-4** `save` SHALL write `communication = {platform:'smtp', connection:'email', notifications_enabled:true, sender, smtp:{host, port, use_tls, security}}` merged over existing `communication`, where `security` defaults to `starttls` (lower-cased), `port` defaults to 465 for `ssl`, 25 for `none`, else 587, and `use_tls = security !== 'none'`.
- **FR-5** When `domains` is given, `communication.internal_domains` SHALL be the list split on whitespace, comma or semicolon, with leading `@` removed, lower-cased, blanks dropped.
- **FR-6** `smtpFromEnvironment(env)` SHALL return `null` without `SMTP_HOST`; otherwise `{server, port, security}` where security is `SMTP_SECURITY` if one of `starttls|ssl|none`, else `starttls` when `SMTP_USE_TLS` is true/1/yes/on, else `none`; port is `SMTP_PORT` or the security default (465/25/587).
- **FR-7** With no saved connection and `SMTP_HOST` set, the card SHALL be configured and `connected`, `source: 'environment'`, with `settings` = env values plus `communication.sender` from operations.yaml; saved connector settings override them.
- **FR-8** `test('email')` SHALL open a TCP connection from the backend host to the server and port: for `starttls`/`none` it SHALL read the first bytes and succeed only when they start with `220`; for `ssl` it SHALL succeed on TCP connect. Timeout 5 s.
- **FR-9** A failed probe SHALL return `status:'failed'` with one plain reason: refused (`nothing is listening on port N`), unresolved (`check the server name`), timeout (names VPN/firewall/network route), wrong banner, or the raw error message. Success SHALL return `connected` with `Credentials are checked on the first send.`
- **FR-10** `test` SHALL use the saved connector settings when present, else the environment, else `failed` `No mail server: save one in the connector or set SMTP_HOST in the environment.`; with neither a connection nor env it SHALL return `Not connected`.
- **FR-11** `envForTasks()` SHALL expose `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (only those the admin filled), `SMTP_USERNAME`, `SMTP_PASSWORD` (from the secret store) to every agent session.

## Scenarios
### S1 Save with domains
- **When** saving `{server:'smtp.company.com', port:'587', sender:'dataops@company.com', domains:'company.com, @Company.co.uk'}` with password **Then** connection is `{kind:'smtp', env:{SMTP_HOST, SMTP_PORT, SMTP_PASSWORD}, enabled:true}`, `internal_domains = ['company.com','company.co.uk']`, `.mcp.json` has no `email`, `envForTasks` returns host, port, password.
### S2 Missing sender
- **Then** `Send as is required`.
### S3 Environment only
- **Given** `SMTP_HOST=127.0.0.1`, `SMTP_PORT=<p>`, `SMTP_USE_TLS=false`, `communication.sender` set **Then** card is `connected`, `source:'environment'`, settings `{server, port, security:'none', sender}`.
### S4 Env defaults
- `{SMTP_HOST:'smtp.office365.com'}` -> port `25`, security `none`; with `SMTP_USE_TLS=true` -> `587`, `starttls`; no host -> `null`.
### S5 Probe
- **Given** a relay answering `220` **Then** test is `connected` with "from the environment". **When** the relay stops **Then** `failed`, message contains `refused the connection`.
### S6 Nothing configured
- **Then** card `not_connected` and test `failed`.

## Interfaces
- HTTP: `PUT /api/connectors/email`, `POST /api/connectors/email/test`, `DELETE /api/connectors/email`.
- operations.yaml: `connections.email`, `communication.{platform,connection,notifications_enabled,sender,smtp,internal_domains}`, `connectors.email.settings`.
- Env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USE_TLS`, `SMTP_USERNAME`, `SMTP_PASSWORD`.
- `workspace.validate` requires `SMTP_HOST` in `connections.<name>.env` for `kind: smtp` (`workspace.mjs:82`).

## Non-functional constraints
- Password only in the secret store (FR-3, SPEC-connectors-04); never in operations.yaml.
- Test is a network probe from the backend host only; it can differ from the agent's network.

## Known gaps / deviations
- Environment and saved defaults differ on purpose but surprise: `SMTP_HOST` alone means plain SMTP on 25 (matching the plugin), while the form defaults to `starttls` on 587.
- `security` and `port` are not validated on save: any string is accepted and lower-cased into `smtp.security`, and anything other than `none` sets `use_tls: true`; a non-numeric port silently falls back to the default.
- The `ssl` probe only checks TCP connect (no TLS handshake, no banner); `starttls` probe does not issue STARTTLS or AUTH. Credentials are never verified by Test.
- `sender` and `domains` have no env var, so env-only mode gets the sender only from operations.yaml `communication.sender`.
- `notifications_enabled: true` is set on every save and overwrites a previously disabled value.
- Removing the connector leaves `communication` in operations.yaml (SPEC-connectors-02).
- docs/DESIGN.md says the agent receives `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`; code also injects `SMTP_USERNAME`/`SMTP_PASSWORD` when stored. Deployment env aliases `EMAIL_NOTIFICATIONS_ENABLED`/`EMAIL_PROVIDER` (backend README) are not read by the connector code.
- The plugin sender `send_email.py` is not in this repo and is not covered here.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `backend/src/connectors/connector-catalog.mjs:92-103` | `backend/tests/connectors.test.mjs:98` |
| FR-3 | `connector-service.mjs:92-102` | `backend/tests/connectors.test.mjs:98` |
| FR-4, FR-5 | `connector-catalog.mjs:106-110`; `connector-service.mjs:285` | `backend/tests/connectors.test.mjs:98` (port 587 + domains); other defaults none |
| FR-6 | `connector-service.mjs:19-26` | `backend/tests/connectors.test.mjs:140` |
| FR-7 | `connector-service.mjs:57-61` | `backend/tests/connectors.test.mjs:140` |
| FR-8, FR-9 | `connector-service.mjs:29-39,201-208` | `backend/tests/connectors.test.mjs:140` (starttls/none only) |
| FR-10 | `connector-service.mjs:174-189` | `backend/tests/connectors.test.mjs:140` |
| FR-11 | `connector-service.mjs:211-221` | `backend/tests/connectors.test.mjs:98` |

## Open questions
- Should Test perform STARTTLS/AUTH to validate credentials?
