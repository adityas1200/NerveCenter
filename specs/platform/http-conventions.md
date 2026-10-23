---
id: SPEC-platform-07
title: HTTP server conventions (routing, errors, CORS, body and upload limits)
status: implemented
area: platform
owners: []
code:
  - backend/src/api/server.mjs
  - backend/src/lib/http.mjs
  - backend/src/lib/errors.mjs
  - backend/src/api/library-routes.mjs
  - backend/src/config.mjs
  - frontend/src/api/client.ts
last_verified: 2026-10-11
---

# HTTP server conventions

## Purpose
Common contract for every backend route: request pipeline order, JSON error shape, status codes, CORS, JSON body size limits, per-feature upload limits, and how the frontend client consumes them.

## Scope
- In scope: `createApiServer` pipeline, `sendJson`/`sendError`, `readBody`, `errorText`, upload limits, `apiClient` error mapping.
- Out of scope: individual route behaviour.

## Actors and permissions
All callers; admin gating per rbac.md.

## Requirements
- **FR-1** The pipeline SHALL be: `OPTIONS` -> 200 `{ok:true}`; `/health`, `/api/meta`; identity resolution; presence touch; admin-route check; `/api/me`, `/api/presence`; RBAC admin routes; domain routes in order; unmatched -> 404 `{error:"Route not found"}`.
- **FR-2** Every response SHALL be JSON (`application/json; charset=utf-8`) with `access-control-allow-origin: OPS_CORS_ORIGIN` (default `*`), allow-methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`, and allow-headers `content-type,authorization` (plus `x-user-*` only in development identity mode).
- **FR-3** JSON errors SHALL include a plain `error` message and a stable `code` derived from the HTTP status; a cross-project denial may also include `projectId`. Explicit HTTP errors SHALL keep their status; unexpected errors SHALL return 500 with a generic message and be logged without exposing their raw message to the caller. The frontend SHALL keep success response bodies unchanged.
- **FR-4** `readBody` SHALL buffer the request, return `undefined` for an empty or whitespace body, parse JSON, return 400 `INVALID_REQUEST` for invalid JSON, and return 413 `PAYLOAD_TOO_LARGE` when the body exceeds `OPS_MAX_REQUEST_BYTES` (default 8 MiB).
- **FR-5** Knowledge document upload routes (`POST /api/knowledge/upload`, `POST /api/knowledge/:name/documents`) SHALL read with a larger limit (`UPLOAD_REQUEST_BYTES` = 1.4 x 25 MiB + 64 KiB) and then enforce at most 50 files, 25 MiB total decoded, and supported document types (400 otherwise).
- **FR-6** Skill zip uploads SHALL be limited to 25 MiB decoded, template uploads to 20 MiB decoded; both are sent as base64 JSON, so they are also bounded by FR-4 (8 MiB request) unless the route uses a larger limit.
- **FR-7** `errorText(error)` SHALL flatten up to four levels of `cause`, append error codes, redact `authorization|password|token|secret` values and cap output at 400 chars; it is the standard way to report provider/network failures.
- **FR-8** Paths SHALL be matched on segments; path parameters are `decodeURIComponent`-decoded by handlers that need it (tickets, pipelines, secrets); users, connections and settings sections are used raw.
- **FR-9** The frontend `ApiError` SHALL carry `status`, `details` and `code`; the message SHALL come from `error` or `message` in a JSON body, else the text body or status text; network failure SHALL map to status 0, code `NETWORK_ERROR`; all requests SHALL send cookies and `accept: application/json`; `204` returns undefined.

## Scenarios
### S1 Unknown route
- **When** `GET /api/registry/agents`
- **Then** 404 `{"error":"Route not found","code":"NOT_FOUND"}` (`api.test.mjs` removed-routes test).

### S2 Non-admin on admin route
- **Then** 403 with the administrator message, before the handler runs.

### S3 Oversized upload
- **Given** a 12 MiB base64 knowledge upload with a bad file type
- **Then** it passes the body limit and fails with 400 "not a supported document" (`api.test.mjs`).

### S4 Handler throws plain Error
- **Then** 500 `INTERNAL_ERROR` with a generic message, while the original error is logged.

## Interfaces
- Config: `OPS_CORS_ORIGIN`, `OPS_MAX_REQUEST_BYTES`, `OPS_MAX_UPLOAD_BYTES` (exposed in `/api/meta` only).
- Client: `frontend/src/api/client.ts` (`apiClient.get/post/put/patch/delete`, SSE helper), base `VITE_API_BASE_URL`.

## Non-functional constraints
JSON is pretty-printed (indent 2) on every response. No request timeout, rate limiting, compression, or request-id logging at the server level.

## Known gaps / deviations
- Remaining service-specific input rules should be checked as their routes change; untyped errors now fail closed as generic 500 responses.
- `config.maxUploadBytes` is advertised via `/api/meta` but unused; real limits are scattered hard-coded constants (25 MiB skills, 20 MiB templates, 25 MiB knowledge) and a skills/template zip of up to the stated size cannot fit in the 8 MiB default body limit once base64-encoded, so the effective limit is 8 MiB (about 6 MiB decoded) unless the route passes a larger limit (only knowledge does).
- CORS allows any origin by default; production boot requires an explicit origin, but `access-control-allow-credentials` is never sent, so cross-origin cookie auth would not work.
- Direct route error replies that use `{error}` receive a status-derived code through `sendJson`.
- Untested: CORS headers and `errorText` redaction.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/api/server.mjs:30-41,137` | `backend/tests/api.test.mjs:20,113` |
| FR-2 | `backend/src/lib/http.mjs:17-27` | none |
| FR-3 | `backend/src/api/server.mjs`, `backend/src/lib/http.mts` | `backend/tests/api.test.mjs` (API error contract and ticket input status) |
| FR-4 | `backend/src/lib/http.mts`, `backend/src/config.mjs` | `backend/tests/api.test.mjs` (invalid and oversized JSON) |
| FR-5 | `backend/src/api/library-routes.mjs:28,30`, `backend/src/knowledge/knowledge-service.mjs:81-107` | `backend/tests/api.test.mjs:100`, `backend/tests/knowledge-upload.test.mjs` |
| FR-6 | `backend/src/skills/skill-service.mjs:12,33`, `backend/src/documents/template-service.mjs:36,53` | none (size limits not asserted) |
| FR-7 | `backend/src/lib/errors.mjs:5-15` | none |
| FR-8 | `backend/src/api/server.mjs:17,63,131` | none |
| FR-9 | `frontend/src/api/client.ts` | `frontend/src/api/client.contract.test.ts` |

## Decision
Keep existing direct success payloads. Error payloads use `{error,code}` with a status-derived code.
