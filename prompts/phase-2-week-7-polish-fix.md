# Phase 2 — Week 7 Polish Fix

## Context

HEAD: `851fe48` — "fix(core): rename PreconditionResult.resolvedValue to resolved_value"
Current passing tests: 178 (132 core + 35 CLI + 11 MCP).

This prompt fixes two defects identified in post-Week-7 review. Both are correctness
bugs, not feature additions. No new commands, flags, or public exports.

---

## Fix 1: Dot-path override support in `realm replay`

### Problem

`replayRun` in `packages/cli/src/commands/replay.ts` applies step output overrides with a
flat key assignment:

```typescript
replayEvidenceByStep[override.step]![override.field] = override.value;
```

When `--with "validate_candidates.result.accepted_count=0"` is parsed, `parseOverride`
correctly returns `{ step: 'validate_candidates', field: 'result.accepted_count', value: 0 }`.
But the assignment above creates a literal key `"result.accepted_count"` at the top level:

```
{ "result.accepted_count": 0 }   // ← wrong
{ result: { accepted_count: 0 } } // ← what evaluatePrecondition expects
```

`evaluatePrecondition` calls `resolvePath` which walks dot-separated segments. It will never
find the literal-dot key, so the override is silently non-functional for any precondition
that references a nested field.

The playbook extraction workflow has:
```
preconditions: ["validate_candidates.result.accepted_count > 0"]
```

This is the primary use case for `realm replay`. The command is broken for this workflow.

A second issue: the initial copy of `evidenceByStep` uses `{ ...output }` (shallow spread).
After converting to `deepSet`, nested objects inside `output` would share references with
the originals. Apply `structuredClone` on the initial copy to prevent mutation of the
original evidence map.

### Changes — `packages/cli/src/commands/replay.ts`

**1. Add a private `deepSet` helper** immediately after the `parseLiteralValue` function:

```typescript
/**
 * Sets a value at a dot-separated path within an object, creating
 * intermediate objects as needed.
 */
function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}
```

**2. Change the initial evidence copy** in `replayRun` from shallow spread to `structuredClone`.

Find:
```typescript
  for (const [stepId, output] of Object.entries(evidenceByStep)) {
    replayEvidenceByStep[stepId] = { ...output };
  }
```
Replace with:
```typescript
  for (const [stepId, output] of Object.entries(evidenceByStep)) {
    replayEvidenceByStep[stepId] = structuredClone(output) as Record<string, unknown>;
  }
```

**3. Replace the flat override assignment** with `deepSet`.

Find:
```typescript
    replayEvidenceByStep[override.step]![override.field] = override.value;
```
Replace with:
```typescript
    deepSet(replayEvidenceByStep[override.step]!, override.field, override.value);
```

### Changes — `packages/cli/src/commands/replay.test.ts`

**3a. Add one test to `describe('parseOverride', ...)`** — multi-segment field path:

```typescript
  it('parses a multi-segment dot-path field — "validate.result.accepted_count=5"', () => {
    const result = parseOverride('validate.result.accepted_count=5');
    expect(result).toEqual({ step: 'validate', field: 'result.accepted_count', value: 5 });
  });
```

**3b. Add two tests to `describe('replayRun', ...)`** — at the end of that describe block:

```typescript
  it('dot-path override correctly changes a nested-field precondition outcome', () => {
    const nestedDef: WorkflowDefinition = {
      ...definition,
      steps: {
        ...definition.steps,
        write: {
          description: 'Write results',
          execution: 'auto',
          allowed_from_states: ['validated'],
          produces_state: 'completed',
          preconditions: ['validate.result.accepted_count > 0'],
        },
      },
    };
    const evidence = [makeSnapshot('validate', { result: { accepted_count: 3 } })];
    const run = makeRun(evidence);
    const results = replayRun(run, nestedDef, [
      { step: 'validate', field: 'result.accepted_count', value: 0 },
    ]);
    const writeRow = results.find((r) => r.step_id === 'write')!;
    expect(writeRow.preconditions_original).toBe(true);
    expect(writeRow.preconditions_replay).toBe(false);
    expect(writeRow.changed).toBe(true);
  });

  it('dot-path override does not mutate the original evidence object', () => {
    const nestedDef: WorkflowDefinition = {
      ...definition,
      steps: {
        ...definition.steps,
        write: {
          description: 'Write results',
          execution: 'auto',
          allowed_from_states: ['validated'],
          produces_state: 'completed',
          preconditions: ['validate.result.accepted_count > 0'],
        },
      },
    };
    const originalOutput = { result: { accepted_count: 3 } };
    const evidence = [makeSnapshot('validate', originalOutput)];
    const run = makeRun(evidence);

    replayRun(run, nestedDef, [
      { step: 'validate', field: 'result.accepted_count', value: 0 },
    ]);

    // Original evidence must not have been mutated.
    expect(originalOutput.result.accepted_count).toBe(3);
  });
```

---

## Fix 2: Remove `console.error` from engine — surface as warning

### Problem

In `packages/core/src/engine/execution-loop.ts`, Step 5 handles dispatch failure. When the
step dispatch has already failed, the engine tries to write `state: 'failed'` to the store.
If that store update also throws, the current code:

1. Calls `console.error` (library code writing to stderr — wrong for a library)
2. Returns `warnings: []` — caller receives no indication the store is in an inconsistent state

MCP tools, CLI commands, and tests all see `warnings: []` and cannot distinguish between
"run safely marked failed" and "run is in an unknown state due to a double failure".

The fix: capture the cleanup failure in a local variable, return it as a `warnings` entry.

### Change — `packages/core/src/engine/execution-loop.ts`

Locate Step 5. Find this exact block:

```typescript
  // Step 5: Handle dispatch failure — mark run as failed (terminal) and return error envelope.
  if (dispatchError !== null) {
    try {
      await store.update({
        ...pendingRun,
        state: 'failed',
        terminal_state: true,
        terminal_reason: dispatchError.message,
        evidence: [...pendingRun.evidence, ...allEvidence],
      });
    } catch (cleanupErr) {
      // Best-effort cleanup — do not throw if the failure update itself fails.
      console.error(
        `Failed to mark run as failed after step error: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
      );
    }
    return {
      command: options.command,
      run_id: options.runId,
      snapshot_id: pendingRun.version.toString(),
      status: 'error',
      data: {},
      evidence: allEvidence,
      warnings: [],
      errors: [dispatchError.message],
      next_action: null,
    };
  }
```

Replace with:

```typescript
  // Step 5: Handle dispatch failure — mark run as failed (terminal) and return error envelope.
  if (dispatchError !== null) {
    let cleanupWarning: string | undefined;
    try {
      await store.update({
        ...pendingRun,
        state: 'failed',
        terminal_state: true,
        terminal_reason: dispatchError.message,
        evidence: [...pendingRun.evidence, ...allEvidence],
      });
    } catch (cleanupErr) {
      // Best-effort cleanup — surface as a warning so callers are aware of the
      // inconsistent state without masking the original dispatch error.
      cleanupWarning = `Failed to mark run as failed after step error: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`;
    }
    return {
      command: options.command,
      run_id: options.runId,
      snapshot_id: pendingRun.version.toString(),
      status: 'error',
      data: {},
      evidence: allEvidence,
      warnings: cleanupWarning !== undefined ? [cleanupWarning] : [],
      errors: [dispatchError.message],
      next_action: null,
    };
  }
```

### Change — `packages/core/src/engine/execution-loop.test.ts`

`vi` is already imported at the top of this file. Add one new `describe` block anywhere
before the final `it('cleanup', ...)` test:

```typescript
  describe('cleanup failure warning', () => {
    it('surfaces cleanup failure as warning when the failed-state store.update throws', async () => {
      const run = await store.create({
        workflowId: 'test-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      // Allow the first store.update (pending state) to succeed; throw on the second
      // (the cleanup write that marks the run as failed after dispatch failure).
      let updateCount = 0;
      const originalUpdate = store.update.bind(store);
      vi.spyOn(store, 'update').mockImplementation(async (record) => {
        updateCount++;
        if (updateCount >= 2) throw new Error('store write failed');
        return originalUpdate(record);
      });

      try {
        const envelope = await executeStep(store, guard, definition, {
          runId: run.id,
          command: 'step-one',
          input: {},
          snapshotId: '0',
          dispatcher: failDispatcher,
        });

        expect(envelope.status).toBe('error');
        expect(envelope.errors[0]).toContain('step failed');
        expect(envelope.warnings).toHaveLength(1);
        expect(envelope.warnings[0]).toMatch(/Failed to mark run as failed/);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
```

---

## Verification

```bash
npm run test
```

All tests must pass. Minimum passing count: **182** (178 existing + 4 new).

```bash
grep -rn 'console.error' packages/core/src/
```

Must return **zero results**.

---

## Constraints

- Do not change `parseOverride` — it already returns multi-segment field paths correctly.
- Do not change the `ReplayOverride` or `ReplayStepResult` types.
- `deepSet` is private (not exported from `replay.ts`).
- `structuredClone` is available in Node 17+ (runtime is Node 24). No polyfill.
- Do not add any new commands, flags, or public exports to any package.
