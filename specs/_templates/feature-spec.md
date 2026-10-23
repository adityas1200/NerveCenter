---
id: SPEC-<area>-<nn>
title: <Feature name>
status: implemented        # draft | approved | implemented | deprecated
area: <tasks | tickets | pipelines | ...>
owners: []
code:                      # source of truth paths this spec describes
  - backend/src/...
  - frontend/src/features/...
last_verified: YYYY-MM-DD  # date the spec was last checked against the code
---

# <Feature name>

## Purpose
One paragraph: the user problem and who it serves.

## Scope
- In scope: ...
- Out of scope / non-goals: ...

## Actors and permissions
Who can do what (roles from RBAC: viewer / operator / admin as applicable).

## Requirements
Numbered, testable, using SHALL. Each ID is stable and referenced by tests.

- **FR-1** The system SHALL ...
- **FR-2** ...

## Scenarios
Given / When / Then, one per behaviour worth testing.

### S1 <name>
- **Given** ...
- **When** ...
- **Then** ...

## Interfaces
- HTTP API: method, path, request, response, error codes
- Data model: tables / files / config keys
- UI: route, key components, empty/loading/error states

## Non-functional constraints
Performance, security, audit, observability.

## Known gaps / deviations
Where the code does not (yet) match intent, or is untested. Do not hide these.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `path:line` | `path` or "none" |

## Open questions
