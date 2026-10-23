---
id: SPEC-knowledge-02
title: Git knowledge base folder selection and inspect
status: implemented
area: knowledge
owners: []
code:
  - backend/src/knowledge/knowledge-service.mjs
  - backend/src/api/library-routes.mjs
  - frontend/src/features/knowledge/AddKnowledgeDialog.tsx
last_verified: 2026-10-03
---

# Git knowledge base folder selection and inspect

## Purpose
Large repositories hold more than the agent needs. Admins can look inside a repository first (folder tree with markdown counts, nothing kept) and then clone only chosen folders, via a cone-mode sparse checkout, plus root-level files such as `index.md`.

## Scope
- In scope: `inspect`, `normalizeFolders`, `folderTree`, sparse add/sync/re-clone, the two-step Add dialog.
- Out of scope: the rest of add/sync/remove (SPEC-knowledge-01), selecting an MCP source.

## Actors and permissions
Admin only (`POST /api/knowledge/inspect` and `POST /api/knowledge`); the inspect call is a POST and so falls under the knowledge admin gate.

## Requirements
- **FR-1** `normalizeFolders` SHALL return `[]` (whole repo) for undefined/null/empty, or when any entry is `.`/empty; SHALL reject non-array input and any path with empty, `.`, `..` or `.git*` segments ("is not a folder inside the repository").
- **FR-2** Folder paths SHALL be normalised (backslashes to `/`, leading `./` or `/` and trailing `/` stripped), de-duplicated, sorted, and a folder inside another chosen folder SHALL be dropped.
- **FR-3** `folderTree(files, maxDepth=4)` SHALL return `{folders, rootFiles, files, markdown}` where each folder has `name, path, files, markdown` counted at all depths below it and `children` populated to depth 4 only; markdown means `.md`/`.markdown`.
- **FR-4** `inspect` SHALL make a throwaway `--depth 1 --filter=blob:none --no-checkout` clone in the OS temp dir (`nc-knowledge-inspect-*`), list `HEAD` files, drop any path with a dot-prefixed segment, and return `{url, branch, commit, suggestedTitle, ...tree}`; the temp clone SHALL be removed on success and failure.
- **FR-5** The inspect token SHALL be used for that one command only and SHALL NOT be stored; errors SHALL be redacted ("Could not read the repository: ..."); an empty branch SHALL give "The repository has no commits on that branch".
- **FR-6** `add` with `folders` SHALL clone `--no-checkout`, run `sparse-checkout set --cone -- <folders>`, then `checkout`; chosen folders absent on disk afterwards SHALL abort the add ("Not in the repository: ..."), removing clone and secret.
- **FR-7** The chosen folders SHALL be persisted in `.bases.json` as `folders` and re-applied on `sync` and on `reconcileGitBases` re-clone; `list` returns `folders` (`[]` when whole repo).
- **FR-8** `suggestedTitle` SHALL be the repo basename (minus `.git`), dashes/underscores to spaces, first letter capitalised.
- **FR-9** UI: the Add dialog SHALL be two steps: (1) URL, branch, optional token and token username with "Look inside"; (2) folder checklist (whole repo toggle, nested rows, markdown count of the choice) and display name, then Add. An MCP source option points to a connected server.
- **FR-10** Selecting a parent folder SHALL show its children as covered; the markdown total SHALL count everything under chosen folders plus root markdown files.

## Scenarios
### S1 Inspect leaves nothing
- **Given** a repo with `runbooks/`, `platform/`, `README.md`
- **When** POST `/api/knowledge/inspect`
- **Then** 200 tree with counts; no folder under `knowledge/` and no temp dir remains.

### S2 Token never leaks
- **Given** a bad URL and token `secret123`
- **When** inspect fails
- **Then** the error text does not contain the token.

### S3 Sparse add and sync
- **Given** folders `["runbooks"]`
- **When** add, upstream commit, sync
- **Then** only `runbooks/` and root files are on disk before and after sync; `folders` in the list is `["runbooks"]`.

### S4 Unsafe folder
- **When** `folders: ["../etc"]` or `[".github"]`
- **Then** 400 "is not a folder inside the repository".

## Interfaces
- `POST /api/knowledge/inspect {url, branch?, token?, username?}` -> 200 tree.
- `POST /api/knowledge {title?, name?, url, branch?, token?, username?, folders?}` -> 201.
- Data: `.bases.json[name].folders`.
- UI: Add knowledge base dialog on `/knowledge` (admin only).

## Non-functional constraints
- Inspect transfers commits and trees but no blobs; Git timeout 180 s.
- Tokens are sent as `http.extraHeader` Basic auth, never in argv URL.

## Known gaps / deviations
- The dot-segment filter in inspect hides `.github`-style folders from the tree, and `normalizeFolders` rejects any `.git*` name including `.github`, so those folders cannot be selected (intentional but undocumented).
- Tree depth stops at 4; a deeper folder can only be chosen via its ancestor (UI) or by API.
- Root files other than the root `index.md` are checked out too (cone-mode behaviour) and are indistinguishable in the UI.
- Changing folders on an existing base is unsupported (remove and re-add); `sync` re-applies the saved set only.
- Inspect shares the local-path/`file://` acceptance of `normalizeGitUrl`, letting an admin read any local git repo.
- Inspect runs synchronously per request with no rate limit or concurrency cap.
- Frontend dialog test covers the happy two-step path only; no test for token username, branch, or MCP source option.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/knowledge/knowledge-service.mjs:39-51` | `backend/tests/knowledge-folders.test.mjs:38` |
| FR-2 | `knowledge-service.mjs:44-50` | `knowledge-folders.test.mjs:38` |
| FR-3 | `knowledge-service.mjs:54-74` | `knowledge-folders.test.mjs:47` |
| FR-4 | `knowledge-service.mjs:102-120` | `knowledge-folders.test.mjs:57` |
| FR-5 | `knowledge-service.mjs:106,110,113` | `knowledge-folders.test.mjs:77` |
| FR-6 | `knowledge-service.mjs:138-148` | `knowledge-folders.test.mjs:87` |
| FR-7 | `knowledge-service.mjs:150,175,207-214` | `knowledge-folders.test.mjs:87,146` |
| FR-8 | `knowledge-service.mjs:76,116` | `knowledge-folders.test.mjs:57` |
| FR-9 | `frontend/src/features/knowledge/AddKnowledgeDialog.tsx:45-69,108-144` | `frontend/src/features/knowledge/KnowledgePage.test.tsx:130` |
| FR-10 | `AddKnowledgeDialog.tsx:67,151-198` | `KnowledgePage.test.tsx:130` |

## Open questions
- Should folders of an existing base be editable without re-adding?
