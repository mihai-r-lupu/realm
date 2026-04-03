# Phase 2 — Week 8: Testing Package

## Context

HEAD: `bfe4dee` — "fix(replay): dot-path override with deepSet + structuredClone; fix(engine): surface cleanup failure as warning"
Current passing tests: 183 (133 core + 38 CLI + 11 MCP + 1 testing)

`packages/testing` is currently a stub: one `export const VERSION = '0.1.0'` and one
test. This week fills it with the full `@sensigo/realm-testing` package as specified in
the plan, adds a `realm test` CLI command to `packages/cli`, and brings total tests to
**215+**.

---

## Scope

**In scope:**
- `packages/testing/src/` — fully implemented (not a stub)
- `packages/cli/src/commands/test.ts` — new `realm test` command
- `packages/cli/src/commands/test.test.ts` — tests for `realm test`
- `packages/testing/package.json` — add runtime dependencies
- `packages/cli/package.json` — add `@sensigo/realm-testing` dependency

**Not in scope:**
- Changes to `packages/core` or `packages/mcp-server`
- Postgres store
- Real Google Docs or Bubble adapters

---

## Package: `@sensigo/realm-testing`

### 1. Dependencies

Add to `packages/testing/package.json`:

```json
{
  "dependencies": {
    "@sensigo/realm": "*",
    "js-yaml": "^4.1.1"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^25.5.0",
    "typescript": "*",
    "vitest": "*"
  }
}
```

Also add to `packages/cli/package.json` dependencies:
```json
"@sensigo/realm-testing": "*"
```

### 2. File structure

```
packages/testing/src/
├── index.ts                     — re-exports public API (replaces stub)
├── store/
│   └── in-memory-store.ts       — InMemoryStore implements RunStore
├── fixtures/
│   └── fixture-loader.ts        — TestFixture type + loadFixture()
├── mocks/
│   ├── mock-service.ts          — MockServiceRecorder
│   ├── mock-agent.ts            — createAgentDispatcher()
│   └── mock-gate.ts             — createGateResponder()
├── assertions/
│   └── evidence.ts              — assert helpers (throw Error, not vitest expect)
├── helpers/
│   ├── test-step-handler.ts     — testStepHandler()
│   ├── test-processor.ts        — testProcessor()
│   └── test-adapter.ts          — testAdapter()
└── runner/
    └── test-runner.ts           — runFixtureTests() + TestResult
```

Replace `src/index.test.ts` with real tests covering the new exports.

---

### 3. `InMemoryStore` — `store/in-memory-store.ts`

Implements the `RunStore` interface from `@sensigo/realm` using a `Map<string, RunRecord>`.

```typescript
import { WorkflowError, type RunStore, type RunRecord, type CreateRunOptions } from '@sensigo/realm';
import { v4 as uuidv4 } from 'uuid'; // NOT available — use crypto.randomUUID() instead
```

**Important:** `uuid` is NOT a dependency of the testing package. Use `crypto.randomUUID()`
(available in all Node 18+ environments) for run IDs.

Behaviour:
- `create()` — inserts a new record with `id: crypto.randomUUID()`, `version: 0`
- `get(runId)` — returns the record or throws `WorkflowError(STATE_RUN_NOT_FOUND, category: STATE, agentAction: report_to_user, retryable: false)`
- `update(record)` — checks `record.version` equals stored `version`. On mismatch throws
  `WorkflowError(STATE_SNAPSHOT_MISMATCH, category: STATE, agentAction: report_to_user, retryable: true)`.
  On success, writes record with `version + 1` and returns the newly stored record.
- `list(workflowId?)` — returns all records, optionally filtered by `workflow_id`

No async file I/O. No locking. Fully synchronous internally; `async` only by interface contract.

---

### 4. `TestFixture` — `fixtures/fixture-loader.ts`

```typescript
import { load } from 'js-yaml';
import type { ServiceResponse } from '@sensigo/realm';

/** Represents a structured response mock for a service operation. */
export interface MockOperations {
  [operation: string]: ServiceResponse;
}

/** A single test scenario loaded from a fixture YAML file. */
export interface TestFixture {
  /** Human-readable fixture name, used in test output. */
  name: string;
  /** Params passed to start_run. */
  params: Record<string, unknown>;
  /**
   * Mock adapter responses keyed by adapter name, then operation name.
   * Example: { google_docs: { fetch_document: { status: 200, data: { text: '...' } } } }
   */
  mocks: Record<string, MockOperations>;
  /**
   * Pre-built agent responses keyed by step ID.
   * Used by the dispatcher for steps with execution: agent.
   */
  agent_responses: Record<string, Record<string, unknown>>;
  /**
   * Gate choices keyed by step name. Defaults to 'approve' for any step not listed.
   */
  gate_responses?: Record<string, string>;
  expected: {
    /** Expected state of the run after driving it to completion. */
    final_state: string;
    /**
     * Optional list of expected evidence entries. Each entry must match a snapshot
     * in the run's evidence chain (by step_id and optionally status).
     */
    evidence?: Array<{ step_id: string; status?: 'success' | 'error' | 'skipped' }>;
  };
}
```

**`loadFixtureFromFile(filePath: string): TestFixture`** — reads the file synchronously,
calls `loadFixtureFromString`.

**`loadFixtureFromString(content: string): TestFixture`** — parses YAML via `js-yaml.load`,
validates the required fields (`name`, `params`, `expected.final_state`), throws
`Error` if any are missing.

**`loadFixturesFromDir(dirPath: string): TestFixture[]`** — reads all `*.yaml` files from
the directory, parses each, returns the array. Throws if `dirPath` does not exist.

---

### 5. `MockServiceRecorder` — `mocks/mock-service.ts`

Records all calls made to the adapter, in addition to returning pre-configured responses.

```typescript
import { WorkflowError, type ServiceAdapter, type ServiceResponse } from '@sensigo/realm';

export interface RecordedCall {
  method: 'fetch' | 'create' | 'update';
  operation: string;
  params: Record<string, unknown>;
}

/**
 * MockServiceRecorder implements ServiceAdapter. Returns pre-configured responses
 * and records all calls for post-test assertions.
 */
export class MockServiceRecorder implements ServiceAdapter {
  readonly calls: RecordedCall[] = [];

  constructor(
    public readonly id: string,
    private readonly responses: Record<string, ServiceResponse>,
  ) {}

  // All three methods (fetch, create, update) record the call and return responses[operation].
  // If operation is not found, throw WorkflowError(ENGINE_ADAPTER_FAILED, ...)
}
```

---

### 6. `createAgentDispatcher` — `mocks/mock-agent.ts`

Creates a `StepDispatcher` (imported from `@sensigo/realm`) that handles both auto and
agent steps:

```typescript
import { WorkflowError, type StepDispatcher, type WorkflowDefinition, type ExtensionRegistry } from '@sensigo/realm';

/**
 * Creates a StepDispatcher for use in tests.
 *
 * For steps with execution: 'agent': returns the pre-built agent response from
 * agentResponses[stepName]. Throws WorkflowError(ENGINE_HANDLER_FAILED) if not found.
 *
 * For steps with a handler: looks up the handler in registry, calls handler.execute(),
 * returns result.data. Throws WorkflowError(ENGINE_HANDLER_FAILED) if not found.
 *
 * For steps with uses_service: looks up the adapter ID from
 * definition.services[uses_service].adapter in registry, calls adapter.fetch(stepName, input, {}).
 * Returns the data property (cast to Record<string, unknown>).
 * Throws WorkflowError(ENGINE_ADAPTER_FAILED) if not found.
 *
 * For steps with none of the above: returns empty object {}.
 */
export function createAgentDispatcher(
  definition: WorkflowDefinition,
  registry: ExtensionRegistry,
  agentResponses: Record<string, Record<string, unknown>>,
): StepDispatcher
```

---

### 7. `createGateResponder` — `mocks/mock-gate.ts`

A helper used inside the test runner to auto-respond to open human gates.

```typescript
import { submitHumanResponse, type RunStore, type WorkflowDefinition } from '@sensigo/realm';

/**
 * Auto-responds to any open human gate on the run.
 * Reads gate_id and step_name from run.pending_gate, looks up the choice in
 * gateResponses[step_name], defaults to 'approve'. Calls submitHumanResponse.
 * Returns the resulting ResponseEnvelope.
 * @throws Error if run.pending_gate is undefined.
 */
export async function createGateResponder(
  store: RunStore,
  definition: WorkflowDefinition,
  runId: string,
  snapshotId: string,
  gateResponses: Record<string, string>,
): Promise<import('@sensigo/realm').ResponseEnvelope>
```

---

### 8. Evidence assertions — `assertions/evidence.ts`

All assertions **throw `Error`** on failure (not vitest `expect`). This makes them usable
with any test framework.

```typescript
import type { RunRecord, EvidenceSnapshot } from '@sensigo/realm';

/** Throws if run.state !== expectedState. */
export function assertFinalState(run: RunRecord, expectedState: string): void

/**
 * Throws if no non-gate_response snapshot with step_id === stepId and status === 'success'
 * exists in evidence.
 */
export function assertStepSucceeded(evidence: EvidenceSnapshot[], stepId: string): void

/**
 * Throws if no non-gate_response snapshot with step_id === stepId and status === 'error'
 * exists in evidence.
 */
export function assertStepFailed(evidence: EvidenceSnapshot[], stepId: string): void

/**
 * Throws if the last non-gate_response snapshot for stepId does not contain all keys
 * in expected (shallow check — only top-level keys are compared).
 */
export function assertStepOutput(
  evidence: EvidenceSnapshot[],
  stepId: string,
  expected: Record<string, unknown>,
): void

/**
 * Throws if the last non-gate_response snapshot for stepId has evidence_hash !== expectedHash.
 */
export function assertEvidenceHash(
  evidence: EvidenceSnapshot[],
  stepId: string,
  expectedHash: string,
): void
```

---

### 9. Unit test helpers — `helpers/`

These are thin call-through helpers for testing individual extensions in isolation.
They do not interact with the store or engine.

**`helpers/test-step-handler.ts`:**

```typescript
import type { StepHandler, StepHandlerInputs, StepContext, StepHandlerResult } from '@sensigo/realm';

/**
 * Calls handler.execute(inputs, context) and returns the result.
 * context defaults to { run_id: 'test-run', run_params: {}, config: {} } if not provided.
 */
export async function testStepHandler(
  handler: StepHandler,
  inputs: StepHandlerInputs,
  context?: Partial<StepContext>,
): Promise<StepHandlerResult>
```

**`helpers/test-processor.ts`:**

```typescript
import type { Processor, ProcessorInput, ProcessorOutput } from '@sensigo/realm';

/**
 * Calls processor.process(content, config) and returns the result.
 * config defaults to {} if not provided.
 */
export async function testProcessor(
  processor: Processor,
  content: ProcessorInput,
  config?: Record<string, unknown>,
): Promise<ProcessorOutput>
```

**`helpers/test-adapter.ts`:**

```typescript
import type { ServiceAdapter, ServiceResponse } from '@sensigo/realm';

/**
 * Calls adapter.fetch(operation, params, {}) and returns the response.
 * params defaults to {} if not provided.
 */
export async function testAdapter(
  adapter: ServiceAdapter,
  operation: string,
  params?: Record<string, unknown>,
): Promise<ServiceResponse>
```

---

### 10. Test runner — `runner/test-runner.ts`

```typescript
import type { ExtensionRegistry, WorkflowDefinition } from '@sensigo/realm';

export interface TestResult {
  /** Fixture name. */
  name: string;
  passed: boolean;
  /** Error message if passed === false. */
  error?: string;
}

export interface RunFixtureTestsOptions {
  /** Path to workflow.yaml or to the directory containing workflow.yaml. */
  workflowPath: string;
  /** Path to a directory containing *.yaml fixture files. */
  fixturesPath: string;
  /**
   * Optional ExtensionRegistry. If provided, handlers and processors registered
   * here are available to the dispatcher. If omitted, a new empty registry is created
   * per fixture run.
   */
  registry?: ExtensionRegistry;
}

/**
 * Runs all fixture tests for the workflow.
 *
 * For each fixture:
 * 1. Creates an InMemoryStore + StateGuard.
 * 2. Creates mock adapters from fixture.mocks and registers them in a copy of the
 *    provided registry (or a new registry). Adapter id matches the adapter name
 *    from the workflow's services map.
 * 3. Creates a run with fixture.params.
 * 4. Drives the workflow to completion using a loop:
 *    a. Find the next allowed step with guard.getAllowedSteps(run.state)[0].
 *    b. If no next step and not terminal, fail with "workflow stalled".
 *    c. Call executeChain(store, guard, definition, { runId, command: nextStep, input: {},
 *       snapshotId: run.version.toString(), dispatcher }).
 *    d. If envelope.status === 'error': fail the test immediately with the error message.
 *    e. If envelope.status === 'confirm_required': call createGateResponder with
 *       fixture.gate_responses. If the gate response returns an error, fail the test.
 *       After gate response, reload run and continue loop.
 *    f. If envelope.status === 'ok': reload run, continue loop.
 *    g. Repeat until run.terminal_state === true.
 * 5. Assert fixture.expected.final_state using assertFinalState.
 * 6. If fixture.expected.evidence is defined, verify each entry exists in the run's
 *    evidence chain.
 * 7. Catch any Error thrown by assertions or the driver loop — record as failed.
 *
 * Returns TestResult[] (one per fixture).
 */
export async function runFixtureTests(options: RunFixtureTestsOptions): Promise<TestResult[]>
```

**Important implementation notes:**

- The dispatcher is created per-fixture via `createAgentDispatcher(definition, perFixtureRegistry, fixture.agent_responses)`.
- Mock adapters are registered using the adapter name from `definition.services[serviceName].adapter` as the registry key, so `createAgentDispatcher` can find them by that name.
- The loop uses `guard.getAllowedSteps` (from `StateGuard`), not `next_action.instruction.tool`, because `instruction` may be null for steps without a handler.
- The maximum loop iterations is `Object.keys(definition.steps).length * 2 + 10` to prevent infinite loops on circular state definitions.

---

### 11. `index.ts` — public API

Replace the stub with:

```typescript
// @sensigo/realm-testing — testing utilities for Realm workflows

// Store
export { InMemoryStore } from './store/in-memory-store.js';

// Fixtures
export { loadFixtureFromFile, loadFixtureFromString, loadFixturesFromDir } from './fixtures/fixture-loader.js';
export type { TestFixture, MockOperations } from './fixtures/fixture-loader.js';

// Mocks
export { MockServiceRecorder } from './mocks/mock-service.js';
export type { RecordedCall } from './mocks/mock-service.js';
export { createAgentDispatcher } from './mocks/mock-agent.js';
export { createGateResponder } from './mocks/mock-gate.js';

// Assertions
export {
  assertFinalState,
  assertStepSucceeded,
  assertStepFailed,
  assertStepOutput,
  assertEvidenceHash,
} from './assertions/evidence.js';

// Unit test helpers
export { testStepHandler } from './helpers/test-step-handler.js';
export { testProcessor } from './helpers/test-processor.js';
export { testAdapter } from './helpers/test-adapter.js';

// Runner
export { runFixtureTests } from './runner/test-runner.js';
export type { TestResult, RunFixtureTestsOptions } from './runner/test-runner.js';

export const VERSION = '0.1.0';
```

---

## CLI Package Addition

### `packages/cli/src/commands/test.ts`

New command: `realm test <workflow-path> --fixtures <dir>`

```
realm test ./workflows/playbook-extraction/ --fixtures ./workflows/playbook-extraction/fixtures/
```

**Behaviour:**
- Loads workflow from `<workflow-path>` (uses `loadWorkflowFromFile` from `@sensigo/realm`)
- Calls `runFixtureTests({ workflowPath: args.workflowPath, fixturesPath: opts.fixtures })`
- Outputs a table: one row per fixture, showing `PASS` (green) or `FAIL` (red) + error message
- Exits with code 0 if all pass, code 1 if any fail
- If `--fixtures` directory does not exist or contains no fixtures, exits with code 1 and
  a clear error.

**Command signature:**

```typescript
export const testCommand = new Command('test')
  .argument('<workflow-path>', 'Path to workflow directory or workflow.yaml file')
  .requiredOption('-f, --fixtures <dir>', 'Directory containing fixture YAML files')
  .description('Run fixture-based workflow tests')
  .action(async (workflowPath: string, opts: { fixtures: string }) => { ... });
```

Register `testCommand` in the CLI's main `src/index.ts` entry point alongside the other commands.

---

## Tests to write

### `packages/testing/src/index.test.ts` (replaces the stub)

Replace the single `VERSION` test. New test suite — all in `testing/src/index.test.ts`
or separate per-feature test files; agent's choice, but all must be inside `testing/src/`.

Required test coverage (minimum tests, exact count up to agent):

**InMemoryStore — at least 6 tests:**
- `create()` returns a record with version 0
- `get()` returns the created record
- `get()` throws WorkflowError for unknown run ID
- `update()` increments version on success
- `update()` throws WorkflowError(STATE_SNAPSHOT_MISMATCH) on version mismatch
- `list()` filters by workflow_id

**Fixture loader — at least 4 tests:**
- Parses a valid fixture YAML string
- Throws on missing `name`
- Throws on missing `expected.final_state`
- `loadFixturesFromDir` returns multiple fixtures from a temp dir

**MockServiceRecorder — at least 3 tests:**
- `fetch()` returns the configured response and records the call
- `fetch()` throws WorkflowError for unknown operation
- multiple calls accumulate in `calls` array

**Evidence assertions — at least 5 tests:**
- `assertFinalState` passes when state matches
- `assertFinalState` throws when state mismatches
- `assertStepSucceeded` passes when snapshot exists with status 'success'
- `assertStepSucceeded` throws when step is missing
- `assertStepOutput` throws on missing key

**Unit test helpers — at least 3 tests:**
- `testStepHandler` calls the handler and returns its result
- `testProcessor` calls the processor and returns its output
- `testAdapter` calls fetch and returns the response

**createAgentDispatcher — at least 3 tests:**
- Returns pre-built agent response for `execution: agent` step
- Throws WorkflowError when agent step has no pre-built response
- Delegates to handler from registry for handler-based step

**runFixtureTests integration — at least 4 tests:**
- Happy path: 3-step workflow (1 auto + 1 agent + 1 auto), fixture passes
- Agent step with no pre-built response causes fixture to fail with error message
- Wrong expected final_state causes fixture to fail
- Multiple fixtures: mix of pass and fail; result array has correct pass/fail per fixture

### `packages/cli/src/commands/test.test.ts`

At least 3 tests:
- Exit 0 when all fixtures pass (mock `runFixtureTests` to return all passed)
- Exit 1 when any fixture fails
- Error output when fixtures dir does not exist

---

## Verification

```bash
npm run build  # must pass cleanly
npm run test   # must pass — minimum 215 total tests
npm run lint   # must pass
```

Confirm:
```bash
grep -rn 'console.log\|console.error\|console.warn' packages/testing/src/
```
Must return zero results. The testing package never writes to stdout/stderr — callers
do that (the test runner returns `TestResult[]`, the CLI formats and prints).

---

## Constraints

- Do not add vitest `expect` / `describe` / `it` to the non-test source files. The
  helpers and assertions use plain `throw new Error(...)`.
- `InMemoryStore` uses `crypto.randomUUID()` — not `uuid` package (not a dep of `testing`).
- `MockServiceRecorder` extends the same `ServiceAdapter` interface as `MockAdapter` in
  core — they are different classes with different behavior. Do not replace or modify
  `MockAdapter` in core.
- `createAgentDispatcher` must handle the full dispatcher contract: if `stepDef` is
  undefined (step name not in definition), return `{}` rather than throwing.
- Do not change any public API of `@sensigo/realm` or `@sensigo/realm-mcp`.
- The `realm test` command requires `--fixtures` (`.requiredOption`). Running without it
  must print usage and exit.
