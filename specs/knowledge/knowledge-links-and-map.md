---
id: SPEC-knowledge-04
title: Typed links between knowledge pages, and the knowledge map
status: implemented
area: knowledge
owners: [mitesh.shinde]
code:
  - backend/src/knowledge/knowledge-links.mjs
  - backend/src/knowledge/knowledge-drafts.mjs
  - backend/src/knowledge/knowledge-service.mts
  - backend/src/api/library-routes.mjs
  - backend/src/tasks/nervecenter-tools.mts
  - frontend/src/api/library.ts
  - frontend/src/features/knowledge/KnowledgeMap.tsx
  - frontend/src/features/knowledge/knowledgeMapLayout.ts
  - plugin/operations-fleet/skills/knowledge-build/references/structure.md
last_verified: 2026-10-20
---

# Typed links between knowledge pages, and the knowledge map

## Purpose

Ops questions hop across things: a late pipeline feeds a brand, the brand has a stakeholder, the feed has a vendor contact. The knowledge layer stays OKF Markdown in Git (ADR 0022), and the relationships live in each page's frontmatter as typed fields. Sonic follows them one hop at a time, and people see them as a map of the base. Plan: [docs/plans/knowledge-layer.md](../../docs/plans/knowledge-layer.md).

## Scope

- In scope: the typed fields, reading frontmatter as YAML, the catalog's fields, filters and backlinks, writing fields through `update_knowledge`, the map API and the map view on a base page, the new shelves in the build skill.
- Out of scope: a graph database or vector index (ADR 0022), editing pages by hand in the app, links across bases.

## Actors and permissions

| Actor | Can |
|---|---|
| Any project member | Read the map (`GET /api/knowledge/:name/map`), like every knowledge read. |
| Sonic | Read the catalog with filters; write fields on a draft through `update_knowledge` (`knowledge_drafts`). |
| Project owner | Keeps or discards drafts with fields, as today (SPEC-knowledge-01). |

## Requirements

### Fields

- **FR-1** Link fields SHALL be `upstream`, `downstream`, `pipelines`, `brands`, `markets`, `stakeholders`, `vendor`, `owner`, `asked_by`, `uses`, `applies_to`, `systems`, `refs`, `related` and `supersedes`. Each holds one value or a list. A value names a page by its path in the base, with or without `.md`, or something outside the base (a catalog table, a ticket id).
- **FR-2** Scalar fields SHALL be `sla`, `tier`, `response`, `journey`, `era`, `stale_after` and `expected`, each one value of at most 200 characters.
- **FR-3** Frontmatter SHALL be read as YAML, so block lists (`- item`) and quoted values read correctly. A page whose frontmatter is not valid YAML SHALL still be listed, with the fields the line reader finds, and never fail the catalog.

### Catalog

- **FR-4** `knowledge_catalog` SHALL add to each page its link fields (`links: {field: [values]}`), its scalar fields, `staleAfter` and `stale` (true when `stale_after` is before today), and `backlinks`: the pages of the same base whose link fields resolve to it, at most 20.
- **FR-5** A value SHALL resolve to a page when, after trimming and dropping a leading `./`, it equals the page path, or the path without `.md`. Values that do not resolve stay as written and count as external.
- **FR-6** `knowledge_catalog` SHALL take optional filters, combined with AND: `type` (case-insensitive), `field` with `value` (the page has that value in that field, compared resolved, case-insensitive), `linksTo` (the page links to that path) and `stale` (true). With a filter, only matching pages are returned, each with its fields and backlinks. The 400-page cap stays.

### Writing fields

- **FR-7** `update_knowledge` SHALL accept `fields`: an object of link and scalar fields from FR-1 and FR-2. Any other key SHALL refuse the call, naming the key and the allowed ones. At most 15 fields, 20 values a field, 200 characters a value. A secret in a value refuses the call.
- **FR-8** On `create`, the fields SHALL be written into the new page's frontmatter: lists as `[a, b]`, values quoted when YAML needs it.
- **FR-9** On `append`, fields SHALL be merged into the page's frontmatter: list values are added (no duplicates), and a scalar is set to the new value. `content` is optional when `fields` is given. The change stays an uncommitted draft and shows in the draft's diff.

### Map

- **FR-10** `GET /api/knowledge/:name/map` SHALL return the base's pages, at most 400, each with `path`, `title`, `type`, `shelf` (its top folder, or the file name without `.md` for a root page), `status` (`draft` or `kept`), `stale`, `owner`, `description` and its links (`{field, target, page}`, where `page` is the resolved path or null). It also returns the shelves with page, draft and stale counts, totals (`pages`, `kept`, `drafts`, `stale`, `links`, `orphans`: pages with no links either way) and `truncated`. 404 for an unknown base.
- **FR-11** The base page SHALL offer `Map` and `Files` views (`?view=map`).
  - Map draws every page as a node grouped by shelf around the centre, with typed links as lines.
  - Colour shows state only: kept, draft and stale, with a legend.
  - Hovering a node lights its links and neighbours.
  - Selecting a node opens a side panel: title, type, shelf, status, owner, fields, links out and links in, and "Open page", which switches to Files on that page.
  - Shelf filter chips and a search box narrow the nodes.
  - Totals sit above the map.
  - The view has loading, empty ("No pages yet") and error states, and works with the keyboard (Tab through nodes, Enter to select, Escape to close).
- **FR-12** The map SHALL draw at most 400 nodes and run its layout once per data change, with no animation loop after it settles. It SHALL respect reduced motion.

### Build skill

- **FR-13** The `knowledge-build` structure reference SHALL add the `business/`, `requests/` and `evals/` shelves with their templates, the fields per type, and the client's ontology or semantic layer as a `sources/` entry read live.

## Scenarios

### S1 Follow links
- **Given** `pipelines/eu-sales.md` with `brands: [business/brand-x]` and `business/brand-x.md` with `stakeholders: [team/brand-x-lead]`
- **When** Sonic calls `knowledge_catalog` with `linksTo: business/brand-x`
- **Then** it gets `pipelines/eu-sales.md`, and the brand page lists that pipeline under `backlinks`.

### S2 Correction to a field
- **When** Sonic appends `fields: {upstream: [pipelines/affiliate-feed]}` to `pipelines/eu-sales.md`
- **Then** the page's `upstream` holds both feeds, the base shows one draft, and the diff shows the frontmatter line.

### S3 Bad field
- **When** `fields` has `colour: red`
- **Then** the call is refused, naming `colour` and the allowed fields, and nothing is written.

### S4 Map
- **Given** a base with 3 kept pages, 1 draft and 1 stale page
- **When** a viewer opens `/knowledge/<base>?view=map`
- **Then** they see 5 nodes in their shelves, totals 5 pages · 1 draft · 1 stale, and selecting a node shows its links.

## Interfaces

- **HTTP:** `GET /api/knowledge/:name/map`.
- **Tools:**
  - `knowledge_catalog {base?, type?, field?, value?, linksTo?, stale?}`;
  - `update_knowledge` adds `fields`.
- **Data:** frontmatter fields on pages. No new files, tables or migrations.
- **UI:** `/knowledge/:name?view=map`, `KnowledgeMap`.

## Non-functional constraints

- A map or catalog call reads at most 400 pages of at most 200 KB of frontmatter scan each, the same as today.
- Field values are data written by people and the agent. They are rendered as text, never as HTML.

## Known gaps / deviations

- Links resolve within one base only.
- A fields-only append (FR-9) changes the frontmatter without draft markers, so the map shows that page as kept while it still waits in the drafts review. The drafts list and the base's draft count are right; the map reads page text, not the working tree.

## Traceability

| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2, FR-5 | `knowledge-links.mjs` | `backend/tests/knowledge-links.test.mjs` |
| FR-3 | `knowledge-drafts.mjs` `readFrontmatter` | `backend/tests/knowledge-links.test.mjs` |
| FR-4, FR-6 | `knowledge-drafts.mjs` `catalog` | `backend/tests/knowledge-links.test.mjs` |
| FR-7 to FR-9 | `knowledge-drafts.mjs` `write` | `backend/tests/knowledge-links.test.mjs` |
| FR-10 | `knowledge-service.mts` `map`; `library-routes.mjs` | `backend/tests/knowledge-links.test.mjs` (route) |
| FR-11, FR-12 | `KnowledgeMap.tsx`, `knowledgeMapLayout.ts` | `frontend/src/features/knowledge/KnowledgeMap.test.tsx` |
| FR-13 | `knowledge-build/references/structure.md` | plugin validator, `knowledge-build-interview-guide` eval |
