---
id: SPEC-skills-01
title: Skills library (browse, upload, remove)
status: implemented
area: skills
owners: []
code:
  - backend/src/skills/skill-service.mjs
  - backend/src/api/library-routes.mjs
  - backend/src/workspace/workspace.mjs
  - backend/src/app/rbac.mjs
  - frontend/src/features/skills/SkillsPage.tsx
  - frontend/src/features/skills/skillText.ts
last_verified: 2026-10-03
---

# Skills library (browse, upload, remove)

## Purpose
Show what the agent knows how to do and let an admin extend it. Built-in skills ship in the vendored plugin (read-only); custom skills are zip uploads installed into the workspace's `.claude/skills/`, where the agent picks them up on its next session.

## Scope
- In scope: list, file tree, file read, zip upload (replace), remove custom, Skills UI.
- Out of scope: skill content, how the agent chooses skills (see SPEC-skills-02 for the plugin contract).

## Actors and permissions
- Read (`GET`): every authenticated user.
- Upload and delete: admin only (`ADMIN_ROUTES`: `POST|DELETE /api/skills/*`, enforced in `server.mjs:39`). UI hides upload/remove for non-admins.

## Requirements
- **FR-1** `GET /api/skills` SHALL return plugin skills followed by custom skills; each item has `id` (`plugin:<dir>` or `custom:<dir>`), `name` (SKILL.md frontmatter `name`, else folder), `description`, `origin`, and `heading` (first `# ` heading of the body, else empty); the filesystem `dir` SHALL NOT be exposed.
- **FR-2** Only subfolders containing `SKILL.md` SHALL count as skills.
- **FR-3** `upload` SHALL take `{zipBase64}` (data-URL prefix allowed, optional `name`) and SHALL reject: missing/non-string input, empty buffer, > 25 MB, invalid zip, no `SKILL.md`, and any entry with an absolute path or `..` segment.
- **FR-4** Upload SHALL ignore directories, `__MACOSX` and `.DS_Store` entries, take the shallowest `SKILL.md` as the root, and write only entries under that root into `.claude/skills/<key>/`.
- **FR-5** The skill key SHALL be the slug of `name`, else frontmatter `name`, else the zip folder name, and SHALL match `^[a-z0-9][a-z0-9-]{0,63}$`, else error.
- **FR-6** Uploading an existing custom key SHALL delete and replace it and report `replaced: true`; the result SHALL include `files` (count written) and `uploadedBy` (user id or null).
- **FR-7** `remove` SHALL delete only `custom:*` skills; other ids SHALL fail with 400 "Only custom skills can be removed"; it returns `deleted` (whether the folder existed).
- **FR-8** `tree` and `file` SHALL be confined to the skill folder (`safeJoin`), hide `.git*` entries, list directories first, and refuse files over 2 MB; `file` without `path` SHALL fail "path is required".
- **FR-9** Skill ids SHALL be `origin:slug` with origin `plugin` or `custom`; anything else SHALL throw "Invalid skill id".
- **FR-10** UI: `/skills` SHALL show "Built in" and "Custom" card grids with search over name, display name, heading, description; `/skills/:id` SHALL show the file tree with `SKILL.md` selected by default and an aside splitting the description into "What it does" and "When Sonic uses it". Display names turn folder names into words with acronym upcasing (`rca` -> RCA); the `plugin:` prefix never shows.
- **FR-11** Upload/remove controls SHALL render only when `/api/me` role is `admin`; Remove is shown only for custom skills and after a confirm.

## Scenarios
### S1 Upload and replace
- **Given** a zip `failure-summary/SKILL.md` + `references/style.md` + `__MACOSX/...`
- **When** admin POSTs `/api/skills/upload`
- **Then** 201 `{id: "custom:failure-summary", files: 2, replaced: false, origin: "custom"}`; uploading again gives `replaced: true`.

### S2 Unsafe or empty zip
- **Given** an entry `../escape/SKILL.md`, or a zip with only `readme.md`
- **When** uploading
- **Then** nothing is written outside `.claude/skills`; the second case fails "The zip has no SKILL.md".

### S3 Built-in is protected
- **When** DELETE `/api/skills/plugin:rca`
- **Then** 400 "Only custom skills can be removed".

### S4 Non-admin view
- **Given** role developer/viewer; **When** opening Skills; **Then** list and files readable, no upload button, no Remove menu.

## Interfaces
- `GET /api/skills`; `POST /api/skills/upload {zipBase64,name?}` -> 201; `GET /api/skills/:id/tree` -> `{id,items}`; `GET /api/skills/:id/file?path=` -> `{path,size,content}`; `DELETE /api/skills/:id` -> `{id,deleted}`.
- Data: `<workspace>/.claude/skills/<name>/`; plugin skills under `PLUGIN_DIR/skills/` (env `OPS_PLUGIN_DIR` overrides).
- Errors: unhandled errors map to 400 unless the error carries `statusCode`.

## Non-functional constraints
- Zip cap 25 MB; file read cap 2 MB; whole zip processed in memory.
- Custom skills sync with the workspace to S3 when configured (`workspace-sync.mjs`).

## Known gaps / deviations
- Header comment in `skill-service.mjs:6` says the plugin has 14 skills; the directory has 16 and the test asserts 16.
- Upload content is not validated beyond SKILL.md existence: no frontmatter requirement, no size limit per file or file count (zip bomb bounded only by 25 MB compressed).
- Replace is delete-then-write, not atomic; a failure mid-write leaves a partial skill.
- RBAC lists `skills.manage` for developers, but the routes are admin-only, so the permission is unused for skills.
- Missing skill/file errors surface as 400 (ENOENT), not 404; unknown skill id in `tree` throws a raw ENOENT message.
- Entries inside the zip but outside the SKILL.md root are silently dropped.
- Unsafe-path test tolerates adm-zip normalising the entry, so the `..` rejection branch is not proven (FR-3).
- Custom skills can shadow plugin skills by name in the agent, behaviour unspecified.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/skills/skill-service.mjs:21`, `workspace.mjs:222-236` | `backend/tests/library.test.mjs:19` |
| FR-2 | `workspace.mjs:228` | `library.test.mjs:19` (indirect) |
| FR-3 | `skill-service.mjs:29-38` | `library.test.mjs:19` (empty/no SKILL.md only) |
| FR-4 | `skill-service.mjs:35,39,48-54` | `library.test.mjs:19` |
| FR-5 | `skill-service.mjs:41-42` | none |
| FR-6 | `skill-service.mjs:43-57` | `library.test.mjs:19` |
| FR-7 | `skill-service.mjs:60-66` | `library.test.mjs:19` |
| FR-8 | `workspace.mjs:245-262`, `skill-service.mjs:25-26` | `library.test.mjs:19` |
| FR-9 | `workspace.mjs:237-243` | none |
| FR-10 | `frontend/src/features/skills/SkillsPage.tsx`, `skillText.ts` | `frontend/src/features/skills/SkillsPage.test.tsx:36,73` |
| FR-11 | `SkillsPage.tsx:30,74` | `SkillsPage.test.tsx:62` |
| Admin gate | `backend/src/app/rbac.mjs:67`, `api/server.mjs:39` | none |

## Open questions
- Should developers (who hold `skills.manage`) be allowed to upload?
