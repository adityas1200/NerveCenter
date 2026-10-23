---
id: SPEC-knowledge-01
title: Knowledge bases (Git and local)
status: implemented
area: knowledge
owners: []
code:
  - backend/src/knowledge/knowledge-service.mjs
  - backend/src/api/library-routes.mjs
  - backend/src/workspace/workspace.mjs
  - backend/src/tasks/nervecenter-tools.mjs
  - frontend/src/features/knowledge/KnowledgePage.tsx
  - frontend/src/features/knowledge/knowledgeText.ts
last_verified: 2026-10-03
---

# Knowledge bases (Git and local)

## Purpose
Give the agent team knowledge (SOPs, runbooks, definitions) as markdown. Each base is a folder under `workspace/knowledge/`: either a Git clone mirrored read-only from its repository, or a local folder made by the agent or by hand. Admins add, sync and remove bases; everyone can read them.

## Scope
- In scope: list, add (whole repo), sync, remove, tree, file read, root index, restore after S3 workspace restore, sync-state UI, drafts note, citation resolution.
- Out of scope: folder selection and inspect (SPEC-knowledge-02), the agent's `search_knowledge` scoring beyond noting it reads the same folder.

## Actors and permissions
- Read (`GET /api/knowledge/*`): all authenticated users.
- `POST|PUT|DELETE /api/knowledge/*`: admin only (`ADMIN_ROUTES`, `server.mjs:39`). UI shows Add/Remove/Sync now only for admins.

## Requirements
- **FR-1** `list` SHALL return `{items, mcp}`; each item has `name, title, description, hasIndex, kind (git|local), url, branch, folders, hasToken, addedBy, addedAt, lastSyncAt, lastCommit, lastError, files, pendingChanges`. Bases are the directories under `knowledge/`; `.bases.json` metadata supplies Git details, otherwise `kind` is `local`.
- **FR-2** `mcp` SHALL echo `operations.yaml knowledge.{mode (default local), connection, collections}`.
- **FR-3** `title` SHALL come from metadata, else the base `index.md` frontmatter `title`, else the folder name; `description` from the index frontmatter.
- **FR-4** `add` SHALL clone (`--depth 1`, optional `--branch`) into `knowledge/<slug>`, where slug comes from name, title or repo name (`^[a-z0-9][a-z0-9-]{0,63}$`), and SHALL fail if the folder already exists.
- **FR-5** A supplied token SHALL be stored in the secret store at `knowledge/<name>/GIT_TOKEN` as JSON `{token, username}` (username default `x-access-token`) and passed per command as an `http.extraHeader`, never written to `.git/config` or the URL; URLs containing credentials SHALL be rejected.
- **FR-6** `normalizeGitUrl` SHALL accept `git@`, `ssh://`, `https://` (valid, no userinfo), absolute local paths and `file://`; anything else SHALL fail "must start with https:// or git@".
- **FR-7** A failed clone SHALL delete the folder and the stored secret and throw `Clone failed: <redacted stderr>`; errors SHALL be redacted of Authorization headers and `//user@` userinfo and cut to 400 chars.
- **FR-8** After a successful add the app SHALL write metadata (`kind: git, addedBy, addedAt, lastSyncAt, lastCommit, lastError: null`) and rewrite `knowledge/index.md`.
- **FR-9** `sync` SHALL only work on Git bases (else 400); SHALL refuse with 409 when `git status --porcelain` shows uncommitted/untracked files (agent drafts); otherwise `fetch --depth 1 origin` then `reset --hard @{upstream}`, update `lastSyncAt/lastCommit`, clear `lastError`, rewrite the root index.
- **FR-10** A failed sync SHALL store redacted `lastError`/`lastErrorAt`, keep the base, and throw `Sync failed: ...`.
- **FR-11** `remove` SHALL delete the folder (any kind), its metadata and its secret, rewrite the index, and return whether the folder existed.
- **FR-12** `knowledge/index.md` SHALL list every base as `- [title](name/index.md): description` (link without `index.md` when the base has none).
- **FR-13** `reconcileGitBases` (run at startup) SHALL re-clone each Git base lacking `.git` into a sibling staging folder, swap it in, and record failures in `lastError`; bases with `.git` SHALL be left alone.
- **FR-14** `tree` SHALL return the nested file tree of a base, 404 when the base is missing. `file(name, path)` SHALL read the exact path; if that fails and the path has no `/`, it SHALL fall back to a basename search and use it only when exactly one file matches.
- **FR-15** `pendingChanges` SHALL be the porcelain paths for Git bases and 0 for local bases.
- **FR-16** UI: `/knowledge` SHALL show base cards (title, folders, sync state: Synced <when>, Not synced yet, Sync failed, Local folder), a drafts note ("N drafts from Sonic to review. Sync waits...") and one quiet line linking to Connectors when an MCP source exists. `/knowledge/:name` opens the base at `index.md` with a properties header; `Sync now` is the primary action for admins on Git bases. `/knowledge?path=` opens a cited file, resolving the base from the first path segment (with or without `knowledge/`) or the only base.
- **FR-17** UI error text SHALL turn raw git errors into one sentence (token rejected, not found, unreachable, git missing, drafts waiting).

## Scenarios
### S1 Clone, sync, index, remove
- **Given** a local repo with `index.md`; **When** admin adds it, commits upstream, syncs, removes; **Then** base appears with `lastCommit`, sync advances the commit, root index lists/unlists it, remove returns true.

### S2 Sync blocked by drafts
- **Given** an untracked file in the clone; **When** sync; **Then** 409 "Not synced: 1 uncommitted change ..." and the file is untouched.

### S3 Citation without folder
- **Given** `rca-and-failures/checklist.md` exists once; **When** reading `checklist.md`; **Then** the folder-qualified file returns. Two matches or none -> original ENOENT error.

### S4 Restore after S3 sync
- **Given** a Git base whose `.git` was dropped; **When** startup reconcile runs; **Then** it is re-cloned and `.git` exists again.

## Interfaces
- `GET /api/knowledge`; `POST /api/knowledge` -> 201 base; `POST /api/knowledge/:name/sync`; `GET /:name/tree` -> `{name,items}`; `GET /:name/file?path=` -> `{path,size,content}`; `DELETE /:name` -> `{name,deleted}`.
- Data: `workspace/knowledge/<name>/`, `knowledge/.bases.json`, `knowledge/index.md`, secret `knowledge/<name>/GIT_TOKEN`.
- Agent: `search_knowledge` tool scans `.md/.markdown/.txt` (<= 2000 files, 400 KB each) and returns `knowledge/<path>`.
- Config: `operations.yaml knowledge`; Git CLI timeout 180 s, 32 MB buffer, `GIT_TERMINAL_PROMPT=0`.

## Non-functional constraints
- Tokens never appear in errors, URLs or `.git/config`.
- Workspace S3 sync excludes `.git`; hence FR-13.
- `list` runs `git status` for every Git base and walks every base's files per request.

## Known gaps / deviations
- Local bases are removable through the same admin DELETE, so an agent-authored local base can be deleted with no extra warning (UI confirm only).
- RBAC grants `knowledge.manage` to developers but all write routes are admin-only.
- `normalizeGitUrl` accepts any absolute path and `file://` in production; an admin can mirror arbitrary local directories, and `ssh` URLs are accepted though no key handling exists.
- Missing base/file errors on `file` return 400 (ENOENT text), not 404; only `tree` sets 404.
- `add` stores the secret before clone and `exists(dir)` check is not atomic; concurrent adds of one name can race.
- `sync` of a base whose clone has no upstream (`@{upstream}`) fails with a raw git error.
- `add` after a failed `undo()` may leave a half-cloned folder with no metadata, listed as a `local` base.
- Only the success paths of sync/remove are tested; the 409 pending-changes path, 400 on local sync and `plainSyncError` mapping of real errors lack backend tests (frontend text helper is tested).
- `docs/DESIGN.md` describes MCP knowledge as a base type; code only surfaces `operations.yaml knowledge` as a read-only note.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/knowledge/knowledge-service.mjs:86-95` | `backend/tests/library.test.mjs:55` |
| FR-2 | `knowledge-service.mjs:93-94` | `frontend/src/features/knowledge/KnowledgePage.test.tsx:96` |
| FR-3 | `knowledge-service.mjs:91`, `workspace.mjs:199-209` | none |
| FR-4 | `knowledge-service.mjs:126-143` | `library.test.mjs:55` |
| FR-5 | `knowledge-service.mjs:23,27,134,270-276` | `library.test.mjs:48` (URL), `knowledge-folders.test.mjs:77` |
| FR-6 | `knowledge-service.mjs:29-36` | `library.test.mjs:48` |
| FR-7 | `knowledge-service.mjs:25,136,143` | `knowledge-folders.test.mjs:77` |
| FR-8 | `knowledge-service.mjs:149-153` | `library.test.mjs:55` |
| FR-9 | `knowledge-service.mjs:164-181` | `library.test.mjs:55` (success only) |
| FR-10 | `knowledge-service.mjs:177` | none |
| FR-11 | `knowledge-service.mjs:224-232` | `library.test.mjs:55` |
| FR-12 | `workspace.mjs:212-218` | `library.test.mjs:55` |
| FR-13 | `knowledge-service.mjs:189-222` | `knowledge-folders.test.mjs:146` |
| FR-14 | `knowledge-service.mjs:234-266` | `knowledge-folders.test.mjs:119` |
| FR-15 | `knowledge-service.mjs:157-161` | none |
| FR-16 | `frontend/src/features/knowledge/KnowledgePage.tsx` | `KnowledgePage.test.tsx:46,74,87,96,103` |
| FR-17 | `frontend/src/features/knowledge/knowledgeText.ts:5` | `knowledgeText.test.ts:4,13` |
| Admin gate | `backend/src/app/rbac.mjs:68` | none |

## Open questions
- Should local (agent-made) bases be protected from remove, and should file-not-found be 404?
