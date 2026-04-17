# Report: workflow-schema-version-guard

## Summary

Added a `schema_version` guard to `JsonWorkflowStore.get()` so the engine rejects stale
workflow registrations (those created before the DAG execution model in phase 35) instead of
silently running them with broken eligibility semantics.

## Problem

Workflows registered before phase 35 (commit `a052561`) have no `depends_on` fields on their
steps. Under the DAG model, a step with no `depends_on` is immediately eligible — meaning
every step in a pre-phase-35 registration would appear eligible at once. This is a correctness
failure: the run would exhibit wrong step ordering, and the engine would have no way to detect
it at runtime.

## Solution

Introduced a `schema_version` field, stamped at load time by the YAML loader, that
`JsonWorkflowStore.get()` checks before returning a definition. Any registration without the
field, or with an outdated version, is rejected with `STATE_LEGACY_FORMAT` and a clear
re-registration message.

The pattern mirrors the existing `resolved_profiles` runtime-only field and the legacy run
record detection in `json-file-store.ts`.

## Files changed

| File | Change |
|------|--------|
| `packages/core/src/types/workflow-definition.ts` | Added `schema_version?: number` to `WorkflowDefinition` with a doc comment marking it runtime-only |
| `packages/core/src/workflow/yaml-loader.ts` | Exported `CURRENT_WORKFLOW_SCHEMA_VERSION = 1`; stamped `definition.schema_version` in `loadWorkflowFromString` before return |
| `packages/core/src/workflow/registrar.ts` | Imported constant; added guard in `get()` — throws `STATE_LEGACY_FORMAT` if `schema_version` is missing or outdated |
| `packages/core/src/index.ts` | Exported `CURRENT_WORKFLOW_SCHEMA_VERSION` from the public API |
| `packages/core/src/workflow/registrar.test.ts` | Added `schema_version` to `makeDefinition` helper; added 2 new tests for missing and outdated `schema_version` |
| `packages/core/src/workflow/yaml-loader.test.ts` | Imported constant; added test asserting `def.schema_version === CURRENT_WORKFLOW_SCHEMA_VERSION` |
| `packages/mcp-server/src/tools/create-workflow.ts` | Imported constant; stamped `schema_version` in `buildWorkflowDefinition` |
| `packages/mcp-server/src/tools/mcp-tools.test.ts` | Added `schema_version` to all `WorkflowDefinition` factory functions and inline objects |
| `packages/cli/src/commands/resume.test.ts` | Added `schema_version` to `testWorkflow` |
| `packages/cli/src/commands/respond.test.ts` | Added `schema_version` to `gateWorkflow` |

## Design decisions

- **`schema_version` is optional in the TypeScript type.** This avoids compile errors in all
  existing code that creates `WorkflowDefinition` objects in-memory (test helpers, MCP
  `create_workflow`). The runtime guard in `get()` enforces it only for workflows written to
  and read from disk.

- **`schema_version` is not a user-facing YAML field.** Users do not write it in their YAML
  files. The loader stamps it at parse time, so it exists only in the JSON file produced by
  `realm workflow register`. This follows the same pattern as `resolved_profiles`.

- **`CURRENT_WORKFLOW_SCHEMA_VERSION` is defined once in `yaml-loader.ts` and imported
  everywhere else.** Never duplicated. `registrar.ts`, `create-workflow.ts`, and both test
  files all import the same constant.

- **`create_workflow` (MCP dynamic workflow creation) stamps the version at build time.** The
  `buildWorkflowDefinition` function sets `schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION`
  before registering, so dynamically-created workflows pass the guard cleanly.

## Test results

All 503 tests passing across all packages:

| Package | Test files | Tests |
|---------|------------|-------|
| `@sensigo/realm` (core) | 35 | 350 |
| `@sensigo/realm-mcp` | 4 | 30 |
| `@sensigo/realm-testing` | 1 | 43 |
| `@sensigo/realm-cli` | 13 | 80 |
| **Total** | **53** | **503** |

New tests added: 3 (2 in `registrar.test.ts`, 1 in `yaml-loader.test.ts`).

## Verification

```
$ realm workflow register examples/03-incident-response
Registered: incident-response v1 (4 steps)

$ cat ~/.realm/workflows/incident-response.json | grep schema_version
  "schema_version": 1,
```

Manual test — stale registration (schema_version removed from disk) → guard throws:

```
code: STATE_LEGACY_FORMAT
message: This workflow was registered with an older version of Realm.
         Re-register it with: realm workflow register <path-to-workflow>
```

## Commit

`2a42dc3` — workflow-schema-version-guard: reject stale registrations in JsonWorkflowStore.get()
