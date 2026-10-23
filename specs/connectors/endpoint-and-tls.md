---
id: SPEC-connectors-05
title: Endpoint rules, TLS trust and error redaction helpers
status: implemented
area: connectors
owners: []
code:
  - backend/src/lib/endpoint.mts
  - backend/src/lib/tls.mjs
  - backend/src/lib/errors.mjs
  - backend/src/bootstrap.mjs
last_verified: 2026-10-11
---

# Endpoint rules, TLS trust and error redaction helpers

## Purpose
Real systems (Databricks, ServiceNow, Jira) must be reached over HTTPS, while a developer may point the app at a local stub over HTTP. Corporate networks re-sign TLS traffic with a proxy certificate only the OS trusts. Connection errors must be readable without leaking credentials.

## Scope
- In scope: `normalizeOrigin`, `isLoopbackHost`, `schemeForHost`, `trustSystemCertificates`, `errorText`, and their users (`normalizeServiceNowInstance`, `normalizeJiraSite`, connector and connection save).
- Out of scope: provider API clients.

## Actors and permissions
Library code, no direct actor. Invoked on admin saves of connectors/profiles.

## Requirements
### Endpoint
- **FR-1** `normalizeOrigin(value, {label})` SHALL throw `<label> is required` for blank input.
- **FR-2** A value without `http://` or `https://` SHALL be treated as `https://<value>`; the result SHALL be `url.origin` (path, query, trailing slash dropped; non-default port kept).
- **FR-3** It SHALL reject URLs containing a username or password (`<label> must not contain credentials`).
- **FR-4** It SHALL reject `http:` unless the hostname is loopback (`<label> must use HTTPS (plain HTTP is only allowed for localhost)`); unparseable input or other protocols SHALL throw `<label> must be a valid HTTPS address`.
- **FR-5** `isLoopbackHost` SHALL be true (case-insensitive) for `localhost`, `::1`, `[::1]`, `*.localhost`, and valid IPv4 literals in 127.0.0.0/8; false for other hosts, including names such as `127.evil.example.com`.
- **FR-6** `schemeForHost(host)` SHALL return `http` for a loopback host (port and IPv6 brackets stripped) else `https`.
- **FR-7** ServiceNow and Jira normalizers SHALL apply FR-1..FR-6, keep a loopback port, and build base URLs with `schemeForHost` (ServiceNow: `serviceNowBaseUrl`).
### TLS
- **FR-8** At boot (`bootstrap.mjs:26`) `trustSystemCertificates()` SHALL set Node's default CA list to the union of the bundled and the OS certificate stores, so every outbound HTTPS call (fetch included) trusts them.
- **FR-9** It SHALL do nothing and return `false` when `OPS_TRUST_SYSTEM_CA=0` or when the Node runtime lacks `tls.setDefaultCACertificates`/`getCACertificates`; on failure it SHALL log a `[tls]` warning and return `false` rather than throw.
### Error text
- **FR-10** `errorText(error, fallback)` SHALL join the message (plus `code` when not already in the message) of the error and up to three nested `cause`s with `: `, de-duplicated, fall back to `fallback` when empty, replace `(authorization|password|token|secret)` plus an adjacent value with `<word> [redacted]`, and truncate to 400 characters.

## Scenarios
### S1 HTTPS enforced
- `normalizeOrigin('company.atlassian.net')` -> `https://company.atlassian.net`; `'http://company.atlassian.net'` throws HTTPS; `'https://user:pw@host'` throws credentials; `'https://adb-123.azuredatabricks.net/'` -> no trailing slash.
### S2 Loopback HTTP
- `normalizeOrigin('http://127.0.0.1:8711')` and `'http://localhost:8713/'` succeed; `isLoopbackHost('10.0.0.5')` is false.
### S3 Port retention
- `normalizeJiraSite('http://127.0.0.1:8713')` keeps the port; `normalizeJiraSite('http://jira.internal')` throws HTTPS; `normalizeServiceNowInstance('http://company.service-now.com')` throws HTTPS; `serviceNowBaseUrl` for `127.0.0.1:8712` is `http://...`.
### S4 Corporate proxy
- **Given** a proxy-signed Databricks endpoint **When** the backend starts without `OPS_TRUST_SYSTEM_CA=0` **Then** calls verify against the OS store.
### S5 Wrapped fetch error
- **Given** `TypeError('fetch failed', {cause: Error('unable to get local issuer certificate')})` **Then** `errorText` yields `fetch failed: unable to get local issuer certificate`.

## Interfaces
- Functions exported from `backend/src/lib/endpoint.mts`, `tls.mjs`, `errors.mjs`.
- Env: `OPS_TRUST_SYSTEM_CA` (`0` disables).
- Used by: `ConnectorService.save` for keys `host`, `instance`, `site`; `ConnectionService.save`; `servicenow-service.mjs:52,56`; `jira-service.mjs:38`.

## Non-functional constraints
- Boot-time and process-global: TLS trust affects all outbound HTTPS, not just connectors.
- Never throws on a missing system store.

## Known gaps / deviations
- Only `host`, `instance`, `site` connector fields are normalized; other URLs (custom API `base_url`, MCP `url`) are not subject to the HTTPS rule (SPEC-connectors-02).
- `errorText` redaction is a word-adjacent regex: it over-redacts ("token expired" -> "token [redacted]") and does not catch Bearer values or secrets that follow other labels.
- Test coverage: FR-1..FR-7 tested; TLS helper and `errorText` have no tests.
- `trustSystemCertificates` returns `false` silently on older Node versions, leaving corporate-proxy failures to surface as certificate errors.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2, FR-3, FR-4 | `backend/src/lib/endpoint.mts:15-24` | `backend/tests/endpoint.test.mjs:11` |
| FR-5, FR-6 | `endpoint.mts:5-13,28-31` | `backend/tests/endpoint.test.mjs:11` |
| FR-7 | `backend/src/connectors/servicenow/servicenow-service.mjs:52-56`; `backend/src/connectors/jira/jira-service.mjs:38` | `backend/tests/endpoint.test.mjs:23` |
| FR-8, FR-9 | `backend/src/lib/tls.mjs:9-19`; `backend/src/bootstrap.mjs:26` | none |
| FR-10 | `backend/src/lib/errors.mjs:5-16` | none |

## Open questions
None.
