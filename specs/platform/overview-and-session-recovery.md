---
id: SPEC-platform-16
title: Overview timestamp placement and cookie session recovery
status: approved
area: platform
owners: []
code:
  - frontend/src/features/overview/OverviewPage.tsx
  - frontend/src/components/ops/RefreshRegion.tsx
  - frontend/src/api/session.ts
  - frontend/src/api/client.ts
  - frontend/src/auth.tsx
  - frontend/src/main.tsx
last_verified: 2026-10-21
---

# Overview timestamp placement and cookie session recovery

## Approval
The user approved the conversational plan and requested implementation on 2026-10-21. The approved renewal lead is 180 seconds. Overview changes are restricted to timestamp placement.

This amends SPEC-platform-09 FR-1 for confirmed expiry and invalidated cached sessions only; the first-time anonymous sign-in flow remains unchanged.

## Requirements
- **FR-1** Overview SHALL place each existing section timestamp at the right of the date-range toolbar, retaining its original value and relative formatting. It SHALL preserve query/filter/refresh logic, section loading states, errors, retries, and visitor behavior.
- **FR-2** With cookie SSO enabled, an API 401 SHALL cause one session revalidation using the existing cookie API. Overlapping revalidations SHALL share one request. If authenticated, the original API request SHALL retry once with its method, body, headers, and cancellation preserved. A second 401 SHALL trigger expiry handling.
- **FR-3** An unauthenticated session or second API 401 SHALL produce one visible expiry toast followed after three seconds by the existing app sign-in page. The original pathname, query, and fragment SHALL remain available to the SSO button. Concurrent failures SHALL not duplicate notices or navigation.
- **FR-4** Expiry notifications SHALL render during bootstrap. A first-time anonymous visitor SHALL keep the existing sign-in experience. An explicit bootstrap 401 or invalidated cached session SHALL use the expiry flow. Transient session-check failures SHALL show an error with a retry without declaring expiry.
- **FR-5** API 403, development/auth-disabled operation, platform authentication, login/logout, project headers, SSE parsing, cookie file previews and downloads SHALL preserve their existing behavior. SSE connection establishment SHALL share JSON-request 401 recovery. No application-wide polling SHALL be added.
- **FR-6** Actual renewal SHALL use a verified existing auth-service renewal/expiry contract, run 180 seconds before expiry, recheck on focus/visibility, share concurrent attempts, and reschedule transient failures after 15 seconds. Session checks SHALL NOT be represented as renewal. If the service lacks the contract, this requirement SHALL remain blocked, without guessing endpoints, exposing tokens, changing Azure registration, or modifying another repository.

## Interfaces and constraints
Use the existing `GET {authBase}/session`, `GET {authBase}/login?redirect=...`, and `POST {authBase}/logout` cookie APIs. No public API, auth mode, token storage, schema, or dependency changes. Only internal frontend session coordination and notification interfaces are added. Cookie session checks are bounded by a five-second timeout and are not cached as authorization decisions.

## Scenarios
- Existing independent Overview responses with different generated times retain those exact times in the toolbar; refresh/error behavior is unchanged.
- Concurrent JSON/SSE 401s share a session read; authenticated sessions permit one retry per original request.
- Unauthenticated revalidation or a second 401 produces one toast and one delayed navigation, preserving the original URL.
- Cancelling a caller waiting for shared revalidation does not replay its request or cancel other callers' revalidation.
- Network, malformed-response, or server failures during session validation report verification failure without redirecting. Bootstrap offers retry.
- An anonymous first visit still renders the existing sign-in page; cached-session expiry produces a visible toast even before protected content mounts.

## Verified provider contract and blocked requirement
On 2026-10-21, read-only inspection of the deployed development service's published schema at `https://agenticdm.dev.zsservices.com/apps/api/openapi.json` confirmed the auth paths: login, callback/azure-ad, session, validate-token, me, and logout (with several prefix aliases). There is no documented refresh or renewal operation. `SessionStatus` exposes only `authenticated` and `user`, with no expiry metadata. Anonymous GET probes of `/apps/api/v1/auth/refresh`, `/renew`, and `/refresh-token` returned 404. The sandbox host was unreachable from this workspace.

**FR-6 remains blocked by the external service contract.** No proactive timer is installed and no token renewal is claimed. Implementing real renewal requires a verified provider contract and separate approval for any service changes. The spec remains approved rather than implemented until FR-6 can be fulfilled.

## Traceability
| Requirement | Validation |
| --- | --- |
| FR-1 | `frontend/src/features/overview/OverviewPage.test.tsx` (placement plus existing refresh regressions) |
| FR-2, FR-3, FR-5 | `frontend/src/api/client.recovery.test.ts`, `frontend/src/auth.platform-recovery.test.tsx`, existing login/logout, file and SSE tests |
| FR-4 | `frontend/src/auth.recovery.test.tsx` (bootstrap expiry, first-visit, transient failures, StrictMode and delayed navigation) |
| FR-6 | Provider contract inspection above; blocked, not implemented |

## Implementation verification (2026-10-21)
- Full frontend quality gate passed: governance, strict lint, typechecks, 135 test files / 689 tests (zero failed or skipped), and production build. Vite retained its existing large-chunk warning.
- Focused auth/Overview/SSE/file regression and coverage run: 10 files / 65 tests passed. New session-coordination/notification modules: 98.05% statements, 90.12% branches, 100% functions and lines.
- Local checks used `NODE_OPTIONS=--no-experimental-webstorage` with Node 25 so JSDOM provides browser storage. No test-harness or dependency change was needed.
- FR-1 through FR-5 are implemented and verified. FR-6 remains blocked, so overall spec status remains approved.
