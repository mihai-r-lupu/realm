# Report: phase-36-workflow-context

## Summary

Added a `workflow_context` section to workflow YAML definitions. Named file entries are loaded
once at run start, snapshotted into the run record, and made available in any step prompt via
`{{ workflow.context.NAME }}` (wrapped) and `{{ workflow.context.NAME.raw }}` (raw).

---

## Problem

Workflows that need shared reference material — schemas, instruction documents, coding
guidelines — duplicated file paths across every step that needed them, or relied on agents to
remember content from earlier steps. There was no built-in mechanism to inject static file
content into step prompts.

---

## Solution

`workflow_context` is a new top-level YAML section. Each named entry declares a file path.
The engine reads all declared files on the first `execute_step` call for a run, snaps them
into `workflow_context_snapshots` on the run record, and exposes them to prompt template
resolution via the `workflow.context.*` namespace.

```yaml
workflow_context:
  rules:
    source:
      path: ./rules.md
    description: Coding standards

context_wrapper: xml  # optional; default is xml

steps:
  implement_feature:
    execution: agent
    depends_on: []
    prompt: |
      Apply these rules when writing code:
      {{ workflow.context.rules }}
```

`{{ workflow.context.rules }}` resolves to `<rules>…file content…</rules>`.
`{{ workflow.context.rules.raw }}` resolves to the raw file content with no wrapper.

---

## Files changed

| File | Change |
|------|--------|
| `packages/core/src/types/workflow-definition.ts` | Added `WorkflowContextEntry`, `ContextWrapperFormat`, and `workflow_context?` / `context_wrapper?` fields to `WorkflowDefinition` |
| `packages/core/src/types/run-record.ts` | Added `WorkflowContextSnapshot` interface and `workflow_context_snapshots?` field to `RunRecord` |
| `packages/core/src/workflow/yaml-loader.ts` | Added `existsSync` import; added `context_wrapper` validation, `workflow_context` entry validation and path resolution, auto-registration of `schema.json` |
| `packages/core/src/engine/workflow-context-loader.ts` | New file — `loadWorkflowContext(definition)` reads all declared entries, returns a snapshot map with content, SHA-256 hash, timestamp, and error if unreadable |
| `packages/core/src/engine/prompt-template.ts` | Extended `resolvePromptTemplate` with optional `workflowContext` parameter; added `resolveWorkflowContextRef` and `wrapContent` helpers; `workflow.context.*` references left as-is if the snapshot has an error |
| `packages/core/src/engine/execution-loop.ts` | Added `loadWorkflowContext` import; context loading block after `claimStep`; `workflowContext` included in `buildNextActions` context and gate prompt resolution calls |
| `packages/cli/src/commands/register.ts` | Added `lintWorkflowContext` (exported for testing); warns when a context entry is referenced in more than half the agent step prompts; lint runs after successful registration |
| `packages/core/src/engine/workflow-context-loader.test.ts` | New — 5 unit tests for `loadWorkflowContext` (happy path, multi-entry, missing file, partial failure, empty definition) |
| `packages/core/src/engine/prompt-template.test.ts` | 8 new tests for `workflow.context.*` template resolution (wrapped, raw, xml/brackets/none formats, unknown name, missing context, error snapshot) |
| `packages/core/src/workflow/yaml-loader.test.ts` | 7 new tests for YAML loading: path resolution, `context_wrapper` parsing, invalid wrapper value, missing `source.path`, schema.json auto-registration (present, explicit override, absent) |
| `packages/core/src/workflow/workflow-e2e.test.ts` | 4 new integration tests: snapshots populated after first step, prompt resolved with XML wrapping, file read failure handled gracefully, context entries absent from step tracking fields |
| `packages/cli/src/commands/register.test.ts` | New — 8 tests for `lintWorkflowContext`: threshold boundary (2/4 no warn, 3/4 warn), auto steps excluded, agent steps without prompt excluded, no context → no warnings, returns array not throws |

---

## Design decisions

**Context loaded once, not per step.** Loading happens on the first `execute_step` call for a
run (guard: `workflow_context_snapshots === undefined`). All subsequent steps read from the
snapshot already on the run record. This means file changes after run start are invisible to
the run — consistent with the audit requirement and similar to how `resolved_profiles` behaves.

**Wrapping applied at resolution time.** The run record stores raw file content. The wrapper
format (`xml`, `brackets`, `none`) is applied when `resolvePromptTemplate` expands the
`{{ workflow.context.NAME }}` reference. `{{ workflow.context.NAME.raw }}` always returns raw
content regardless of `context_wrapper`.

**File read failure is non-fatal (D9).** If a file cannot be read, the snapshot records an
`error` field and sets `content` and `content_hash` to empty strings. The step executes
normally. Template references for the failed entry are left as-is (`{{ workflow.context.NAME }}`
stays verbatim in the delivered prompt). The agent sees the unresolved reference and can
handle or report it.

**Auto-registration of `schema.json` (D6).** When `schema.json` is present in the workflow
directory and no `workflow_context.schema` entry is explicitly declared, the loader adds one
automatically. This makes it possible to declare a JSON Schema next to the workflow YAML with
zero extra configuration.

**Name constraints.** Entry names must match `[\w.]+` — underscores and dots only, no hyphens.
Names ending in `.raw` are rejected because `.raw` is reserved as the accessor suffix in the
template syntax.

**Lint warning threshold.** The lint check fires when a context entry is referenced in
strictly more than half (`> floor(N/2)`) of agent steps that have a `prompt`. This requires
at least 2 agent steps with prompts before it fires, so single-step workflows are never warned.
The warning is advisory — registration succeeds regardless.

**`exactOptionalPropertyTypes` compatibility.** The project uses TypeScript's strict optional
property mode. The `workflowContext` field is spread conditionally (`...(x !== undefined ? { workflowContext: x } : {})`) rather than assigned as `workflowContext: x | undefined` at
every call site.

---

## Test results

```
 Test Files  36 passed (36)          @sensigo/realm
      Tests  374 passed (374)

 Test Files  1 passed (1)            @sensigo/realm-testing
      Tests  43 passed (43)

 Test Files  4 passed (4)            @sensigo/realm-mcp
      Tests  30 passed (30)

 Test Files  14 passed (14)          @sensigo/realm-cli
      Tests  88 passed (88)

 Tasks:    8 successful, 8 total
```

All 535 tests pass.

---

## Commit

`2629bd7` — phase 36: workflow_context — named file snapshots injected into step prompts
