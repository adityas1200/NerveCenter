# 0022. Keep the knowledge layer as OKF Markdown in Git, with typed links

- Status: proposed
- Date: 2026-10-20
- Related: docs/plans/knowledge-layer.md, specs/knowledge/knowledge-bases.md, specs/knowledge/knowledge-setup.md, ADR 0012

## Context
Sonic's knowledge is OKF Markdown in Git bases (SPEC-knowledge-01), drafted by the agent and kept by people (SPEC-knowledge-03, lesson capture). Leads asked whether ops knowledge needs a graph or vector retrieval for multi-hop questions (pipeline to brand to stakeholder to vendor POC) and accuracy at scale. A project base is hundreds of pages. Live facts (runs, schemas, lineage, catalog descriptions) are already read through connectors.

## Decision
Knowledge stays one concept per Markdown file with YAML frontmatter in a client-owned Git repo. Relationships are typed frontmatter fields holding page paths or catalog names (`upstream`, `downstream`, `pipelines`, `brands`, `stakeholders`, `vendor`, `refs`). `knowledge_catalog` exposes those fields and will filter by them and return backlinks. Live system facts are referenced, never copied. Every agent write is a draft a person keeps. No graph database, vector index or embedding store is added.

## Alternatives considered
- Graph database for ops entities: a second source of truth to sync and review; the same edges fit in frontmatter and the hop count is small.
- Vector RAG over documents: retrieves fragments without trust or ownership, hides misses, and is unneeded at hundreds of pages.
- Delta tables per entity (as the BMS ontology does): fine for an enterprise ontology we can read as a source, wrong for reviewable operating knowledge that people edit in PRs.

## Consequences
Pages stay readable and reviewable in Git and the Knowledge page; the agent's reads stay small and cited. Aggregate questions depend on typed fields being filled, so the `knowledge-build` structure and the weekly pass must enforce them. If a base grows past a few thousand pages and evals show search misses, a derived index (graph or vector) can be generated from the files without changing the source of truth. Rollback: none needed; this records the current shape.
