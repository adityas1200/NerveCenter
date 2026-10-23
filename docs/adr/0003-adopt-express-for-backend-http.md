# 0003. Adopt Express at the backend HTTP boundary

- Status: accepted
- Date: 2026-10-10
- Related: ADR 0002, specs/platform/http-conventions.md, specs/platform/identity-auth.md, specs/projects/project-access-and-home.md, specs/tasks/task-runtime.md

## Context

The backend has a small custom HTTP router with about 152 route declarations. Its table also carries project scope and permission metadata, and handlers have custom `reply`, `NEXT`, JSON, SSE, and file-response behavior. Express 5 provides routing and middleware, but its defaults do not implement these application rules. Replacing the HTTP layer while converting backend types would combine two large sources of change.

## Decision

After the TypeScript runtime and test path are stable, introduce Express 5 at the HTTP edge in a separate change. First adapt the existing route table to Express while retaining its scope and permission assertions. Move route groups to native Express routers using existing tests and focused contract tests for critical shared mechanisms; keep their permission metadata mandatory. Keep service, store, and Sonic runtime APIs unchanged. Preserve the current URL, response, error, body-limit, CORS, static-file, SSE, and raw-file contracts unless an approved spec changes one of them.

## Alternatives considered

- Replace every route in one change: too much risk to authorization and response compatibility.
- Add Express before TypeScript: gains little while making the type migration harder to diagnose.
- Keep the custom router permanently: remains viable, but does not meet the requested Express direction.

## Consequences

Express becomes an additional dependency and the HTTP entrypoint changes. During the adapter stage, Express and the route table coexist, so there is little immediate code reduction. Express path matching, parameter decoding, `HEAD`/`OPTIONS`, body parsing, error handling, and streaming must be compared with the existing contract. Roll back the HTTP entrypoint to the previous server if parity fails; no data migration is involved.
