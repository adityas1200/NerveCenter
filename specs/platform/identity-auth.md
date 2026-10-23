---
id: SPEC-platform-01
title: Identity and authentication modes
status: implemented
area: platform
owners: []
code:
  - backend/src/app/identity.mjs
  - backend/src/config.mjs
  - backend/src/bootstrap.mjs
  - backend/src/api/server.mjs
  - frontend/src/auth.tsx
  - frontend/src/auth-session.ts
  - frontend/src/api/client.ts
last_verified: 2026-10-03
---

# Identity and authentication modes

## Purpose
Resolve every API request to a user (id, name, groups, roles, role, permissions) and gate the browser UI behind a session. Deployment chooses one of four identity modes; production must use a mode that does not trust client-supplied identity headers.

## Scope
- In scope: `OPS_IDENTITY_MODE` modes, per-request user resolution, blocked accounts, production config assertions, frontend `AuthGate`, login/logout redirects, dev identity headers.
- Out of scope: role resolution and admin gating (see rbac.md), the SSO provider itself (external `OPS_SSO_SESSION_URL`).

## Actors and permissions
Anonymous browser, signed-in user (any role), trusted gateway (sends `x-ops-trusted-identity`), central SSO session service.

## Requirements
- **FR-1** The system SHALL accept `OPS_IDENTITY_MODE` values `development`, `single-user`, `trusted-gateway`, `central-sso` only; any other value SHALL abort boot. The default SHALL be `trusted-gateway` when `NODE_ENV=production`, else `development`.
- **FR-2** In `development` mode the system SHALL take identity from `x-user-id`, `x-user-name`, `x-user-groups`, `x-user-roles` (comma lists), falling back to `OPS_DEFAULT_USER_ID` (`demo.user`) / `OPS_DEFAULT_USER_NAME` when no `x-user-id` is sent.
- **FR-3** In `single-user` mode the system SHALL ignore all identity headers and always resolve to the default user with empty groups and roles.
- **FR-4** In `trusted-gateway` mode the system SHALL require `x-ops-trusted-identity` to equal `OPS_TRUSTED_IDENTITY_TOKEN` (constant-time compare) and a non-empty `x-user-id`; otherwise the request SHALL be rejected.
- **FR-5** In `central-sso` mode the system SHALL forward the request `cookie` header to `OPS_SSO_SESSION_URL` (5 s timeout) and accept the user only when the response is `authenticated: true`. The user id SHALL be the lower-cased email (`email`, `preferred_username`, `upn`), falling back to `user.id` lower-cased. Missing cookie or non-OK reply SHALL yield 401; fetch failure SHALL yield 503.
- **FR-6** After resolving a user the system SHALL auto-provision it in the RBAC store, overlay stored role/blocked state, and reject blocked users with 403 "This account has been blocked...".
- **FR-7** When `NODE_ENV=production`, boot SHALL fail unless: mode is `trusted-gateway` or `central-sso`; `OPS_CORS_ORIGIN` is not `*`; `OPS_SECRET_STORE` is `aws` or `postgres` (postgres also needs the postgres metadata store and `OPS_SECRET_ENCRYPTION_KEY`); an internal service token exists. A trusted-gateway deployment without `OPS_TRUSTED_IDENTITY_TOKEN` SHALL only log a warning (every request is then rejected).
- **FR-8** `GET /health` and `GET /api/meta` SHALL be reachable without identity; every other route SHALL call identity resolution first.
- **FR-9** (Redirect superseded by SPEC-platform-09 FR-1: an unauthenticated browser now sees the sign-in page at `/login`.) The frontend `AuthGate` SHALL, when auth is enabled, call `GET {authBase}/session` with credentials, render "Verifying authentication..." while checking, cache the user in `sessionStorage` (`nervecenter_auth_user`) on success, and otherwise redirect to `{authBase}/login?redirect=<path>`.
- **FR-10** Frontend auth SHALL be enabled unless `VITE_AUTH_ENABLED` (or legacy `VITE_AZURE_SSO_ENABLED`) is `false`; when unset it SHALL default to disabled in `import.meta.env.DEV` and enabled otherwise. `authBase` SHALL be `VITE_AUTH_API_BASE_URL` (default `/dataverse/apps/api/v1`) + `/auth`.
- **FR-11** In Vite dev builds the API client SHALL send `x-user-id`, `x-user-name`, `x-user-roles` from `VITE_DEV_USER_ID/NAME/ROLES` when set; all requests SHALL use `credentials: "include"`.
- **FR-12** `logout()` SHALL clear the cached user, POST `{authBase}/logout`, then redirect to login regardless of outcome.

## Scenarios
### S1 Trusted gateway rejects wrong token
- **Given** mode `trusted-gateway` and a configured token
- **When** a request carries a different `x-ops-trusted-identity`
- **Then** the request fails with an error (see Known gaps for status code).

### S2 Central SSO session valid
- **Given** mode `central-sso` and a valid cookie
- **When** the SSO service returns `{authenticated:true,user:{id,name,email,groups,roles}}`
- **Then** the user is provisioned, role attached, and the request proceeds.

### S3 Blocked user
- **Given** an RBAC record with `blocked: true`
- **When** that user calls any authenticated route
- **Then** the response is 403 and no handler runs.

### S4 Browser without session
_Superseded by SPEC-platform-09 (S1): the browser now lands on the sign-in page, not the SSO redirect._
- **Given** auth enabled and `/session` returns `authenticated:false`
- **When** the app loads
- **Then** the cached user is cleared and the browser is redirected to login with the current path in `redirect`.

## Interfaces
- HTTP: all `/api/*` routes; identity headers above; `GET /api/me` returns `{user:{id,name,groups,roles}, role, permissions}`.
- Config keys: `OPS_IDENTITY_MODE`, `OPS_TRUSTED_IDENTITY_TOKEN`, `OPS_SSO_SESSION_URL` (falls back by `BEACON_ENV`/`APP_ENV`/`NC_ENVIRONMENT` via `SSO_URL_BY_ENV` - zs-dev/dev/development to the dev URL, zs-sandbox/sandbox to the sandbox URL, else sandbox - with a warning), `OPS_INTERNAL_SERVICE_TOKEN` (falls back to trusted token, else random in non-production), `OPS_DEFAULT_USER_ID/NAME`.
- UI: `AuthGate` wraps the app in `frontend/src/main.tsx`; role/permission data via `useMe()` (see rbac.md).

## Non-functional constraints
- Token comparison uses `timingSafeEqual`. SSO validation adds one outbound call per API request (no caching), 5 s timeout.
- CORS `access-control-allow-headers` includes `x-user-*` only in `development` mode.

## Known gaps / deviations
- Trusted-gateway failures (`requestUser` lines 23-29) throw plain `Error` with no `statusCode`, so the server returns 400, not 401/403. Same for an invalid mode at request time. Only central-sso and blocked produce 401/403/503.
- `development` mode trusts any `x-user-id` and, when no role hints exist and the RBAC store is absent, resolves to admin; `OPS_IDENTITY_MODE=single-user` still passes through RBAC provisioning (the default user is provisioned as developer unless in the admin list), so it may not be admin despite the name.
- Frontend has no global 401 handler: an expired session mid-use surfaces as an `ApiError`, not a redirect (`frontend/src/api/client.ts`).
- `/api/me` omits `email` although the identity layer resolves it; `AuthUser.azure_oid` in `auth-session.ts` is unused by the backend.
- Unknown or unset deploy env falls back to the sandbox SSO URL (config.mjs:37-47), a risky default for any other environment.
- SSO ids are now lower-cased email while earlier RBAC records may be keyed by Azure OID; existing users keyed by the old id would be provisioned again as new users (no migration).
- No tests cover trusted-gateway, central-sso, single-user, blocked users, or `assertBackendConfig`; frontend `AuthGate` has no test.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/config.mjs:34,40` | none |
| FR-2 | `backend/src/app/identity.mjs:27-33` | `backend/tests/api.test.mjs:20` (header user) |
| FR-3 | `backend/src/app/identity.mjs:27-31` | none |
| FR-4 | `backend/src/app/identity.mjs:22-26` | none |
| FR-5 | `backend/src/app/identity.mjs:36-52` | none |
| FR-6 | `backend/src/app/identity.mjs:6-13` | none (blocked path untested) |
| FR-7 | `backend/src/bootstrap.mjs:29-39` | none |
| FR-8 | `backend/src/api/server.mjs:34-37` | `backend/tests/api.test.mjs:20` |
| FR-9 | `frontend/src/auth.tsx:24-45` | none |
| FR-10 | `frontend/src/auth.tsx:9-12`, `frontend/src/auth-session.ts:2-4` | none |
| FR-11 | `frontend/src/api/client.ts:36-47,101-107` | none |
| FR-12 | `frontend/src/auth-session.ts:41-47` | none |

## Open questions
- Should identity failures return 401 and should the SPA redirect on 401?
