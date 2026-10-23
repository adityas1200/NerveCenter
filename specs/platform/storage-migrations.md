---
id: SPEC-platform-06
title: Storage backends and database migrations
status: implemented
area: platform
owners: []
code:
  - backend/src/storage/postgres.mjs
  - backend/src/storage/migrations.mjs
  - backend/migrations/001-control-schema.sql
  - backend/src/config.mjs
  - backend/src/app/rbac-store.mts
  - backend/src/secrets/secret-store.mts
  - backend/src/app/operations-store.mts
  - backend/src/tasks/task-store.mts
last_verified: 2026-10-11
---

# Storage backends and database migrations

## Purpose
Persist tickets, tasks, inbox, connection profiles, RBAC and secrets either in local files (dev, tests) or in a shared PostgreSQL (deployed), with schema bootstrap and ordered SQL migrations that are safe with several pods starting at once.

## Scope
- In scope: store selection, pool and schema pinning, `ensureControlSchema`, migration runner, which tables exist and who creates them.
- Out of scope: the business meaning of each table (tickets/tasks specs), S3 workspace sync (settings-workspace.md).

## Actors and permissions
Operators/deployers only; no HTTP surface.

## Requirements
- **FR-1** `OPS_METADATA_STORE` SHALL select `file` or `postgres` (default `postgres` when a database URL is configured, else `file`); the operations, task, connection-profile and RBAC stores SHALL each have a file and a Postgres implementation chosen by it.
- **FR-2** The Postgres pool SHALL be created once (lazy), require `DATABASE_URL`, and size `OPS_PG_POOL_MAX` (default 20). Outside the Databricks customer deployment it SHALL use TLS with `rejectUnauthorized:false` unless `OPS_PG_SSL=disable`.
- **FR-2a** In the Databricks customer deployment, Postgres SHALL require TLS with server certificate verification and reject `OPS_PG_SSL=disable`. Connection URL query options SHALL NOT override its TLS settings. The default Node trust roots SHALL verify the server certificate; a private CA may be provided to the process through `NODE_EXTRA_CA_CERTS`.
- **FR-3** When `NC_DB_SCHEMA` is set, the pool SHALL create the schema if missing (name sanitised to `[A-Za-z0-9_]`) and set `search_path=<schema>,public` on every connection.
- **FR-4** `ensureControlSchema` SHALL run the ordered migrations before any business store reads. Migration `001-control-schema.sql` SHALL idempotently create the base ticket, task, task-event, inbox, RBAC-user, and encrypted-secret tables; ticket/task sequences and status indexes. It SHALL leave existing rows and sequence values unchanged. (`ops_application_settings` is no longer created; migration 009 moved its boards and data quality configs into `ops_boards` and `ops_data_quality_configs` and dropped it, ADR 0004.)
- **FR-5** `applyControlMigrations` SHALL take `pg_advisory_lock(hashtext('nervecenter-control-migrations'))`, create `ops_schema_migrations(name, applied_at)`, apply every `backend/migrations/*.sql` not yet recorded in lexical order, each in its own transaction with the bookkeeping insert, roll back and rethrow on failure, and release the lock.
- **FR-6** Migration `002-ticket-signature.sql` SHALL create the failure-signature index on `ops_tickets`; migration `004-ticket-connection.sql` SHALL create `ops_connection_profiles`, migrate ticket connection ownership, and replace the old global idempotency indexes. The baseline in FR-4 SHALL precede both on a fresh database.
- **FR-7** Business table and index creation SHALL live in numbered SQL migrations, not store initialization. `ops_rbac_users` and `ops_secrets` SHALL be in migration 001 (`ops_rbac_audit` was dropped and `ops_rbac_meta` added by migration 008, ADR 0003). The configured schema and `ops_schema_migrations` tracking table MAY be created by the migration bootstrap because they are prerequisites for running migrations.
- **FR-7a** Migration `010-ticket-events` (ADR 0005) SHALL create `ops_ticket_events (ticket_id FK cascade, seq, id, at, type, data jsonb, primary key (ticket_id, seq))` with an index on `(ticket_id, at DESC)`, copy each ticket's `data->'activity'` into it in array order (missing `id` -> `<ticketId>-<seq>`, missing or invalid `at` -> the ticket's `created_at`, missing `type` -> `ticket.event`), then remove `activity` from `data`; safe to run twice. Its file-store twin `010-ticket-events.mjs` moves each ticket's `activity` to `ticket-events/<ticketId>.json` under the runtime dir.
- **FR-8** `OPS_SECRET_STORE` SHALL be `memory` (default), `aws` or `postgres`; `postgres` requires the postgres metadata store and an encryption key (checked at boot in `bootstrap.mjs`, enforced in production).
- **FR-9** File stores SHALL live under `backend/data` / `RUNTIME_DIR` (`OPS_RUNTIME_DIR`); tests SHALL isolate them under `OPS_TEST_DATA_ROOT`.

## Scenarios
### S1 Two pods boot together
- **Given** a new migration file
- **When** both call `applyControlMigrations`
- **Then** one applies it, the other waits on the advisory lock and sees it recorded.

### S2 Failed migration
- **Given** invalid SQL in a new file
- **Then** the transaction rolls back, the name is not recorded and boot fails.

### S3 Restart keeps RBAC deletions (Postgres)
- **Given** a deleted user
- **When** the process restarts
- **Then** the user stays deleted and the JSON file is not re-imported (`rbac-postgres.test.mjs`).

### S4 Customer database certificate is not trusted
- **Given** a Databricks customer deployment with a Postgres server certificate outside Node's trust roots
- **When** a pool connection is made without the required CA bundle
- **Then** the TLS handshake fails; setting `OPS_PG_SSL=disable` cannot bypass verification.

### S5 Existing database receives the new baseline
- **Given** a database with migrations 002 through 011 already recorded and live ticket/task data
- **When** migration 001 is introduced and startup runs migrations
- **Then** it records 001 without changing existing data or sequence values, then skips previously applied files.

## Interfaces
- Data model: tables in FR-4/FR-5/FR-7; `ops_tickets` unique `(pipeline_id, run_id)` and unique partial `source_key`.
- Config: `DATABASE_URL`/`NC_DATABASE_URL`/`db_*`, `NC_DB_SCHEMA`, `OPS_METADATA_STORE`, `OPS_SECRET_STORE`, `OPS_SECRET_ENCRYPTION_KEY`, `OPS_PG_SSL`, `OPS_PG_POOL_MAX`.

## Non-functional constraints
Migrations are forward-only (no down scripts). The shared RDS path currently uses TLS without certificate verification because its CA is not configured in the Node trust store. Customer Databricks deployments verify the certificate.

## Known gaps / deviations
- The configured schema and migration ledger still require bootstrap DDL outside the numbered chain.
- The shared RDS path still uses `rejectUnauthorized:false`, weakening its TLS until its CA is configured.
- Changing `OPS_SECRET_ENCRYPTION_KEY` makes stored secrets unreadable (documented in `.env.defaults`, no rotation tool).
- Fresh schema and repeat-boot behavior are covered by the Postgres integration suite when a test database is supplied; concurrency and the remaining store behavior require separate coverage.
- File and Postgres stores can diverge in behaviour; there is no migration tool between them except RBAC's one-time file import.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/config.mjs:155`, `backend/src/app/operations-store.mts:81`, `backend/src/tasks/task-store.mts:78` | `backend/tests/rbac-postgres.test.mjs` (RBAC only) |
| FR-2/FR-2a | `backend/src/storage/postgres.mjs` | `backend/tests/postgres-tls.test.mjs` |
| FR-3 | `backend/src/storage/postgres.mjs:14-17` | none |
| FR-4 | `backend/migrations/001-control-schema.sql`, `backend/src/storage/postgres.mjs` | `backend/tests/bootstrap-postgres.test.mjs` |
| FR-5 | `backend/src/storage/migrations.mjs:5-26` | none |
| FR-6 | `backend/migrations/002-ticket-signature.sql`, `backend/migrations/004-ticket-connection.sql` | `backend/tests/bootstrap-postgres.test.mjs` |
| FR-7 | `backend/migrations/001-control-schema.sql`, `backend/migrations/004-ticket-connection.sql` | `backend/tests/bootstrap-postgres.test.mjs` |
| FR-8 | `backend/src/bootstrap.mjs:29-39` | `backend/tests/secret-store.test.mjs` |
| FR-9 | `backend/src/config.mjs:27-28`, `backend/tests/test-environment.mjs` | all backend tests |

## Decision
Move business DDL into the numbered migrations. Keep only configured-schema and migration-ledger creation in bootstrap.
