// Central execution loop — orchestrates state guard, dispatcher, evidence capture,
// run state update, and ResponseEnvelope construction.
// Includes: pending state transitions, step-level retry, step timeouts,
// human gate mechanics, auto-chaining, and precondition evaluation.
import type { RunRecord, EvidenceSnapshot } from '../types/run-record.js';
import type { ResponseEnvelope, NextAction } from '../types/response-envelope.js';
import { WorkflowError } from '../types/workflow-error.js';
import type { WorkflowDefinition, RetryConfig } from '../types/workflow-definition.js';
import type { RunStore } from '../store/store-interface.js';
import type { StateGuard } from './state-guard.js';
import { captureEvidence } from '../evidence/snapshot.js';
import { validateInputSchema } from '../validation/input-schema.js';
import { TERMINAL_STATES, isTerminalState } from './lifecycle.js';
import { checkPreconditions, evaluateAllPreconditions } from './precondition.js';

export type StepDispatcher = (
  stepName: string,
  input: Record<string, unknown>,
  run: RunRecord,
) => Promise<Record<string, unknown>>;

export interface ExecuteStepOptions {
  runId: string;
  command: string;
  input: Record<string, unknown>;
  /** Caller's expected version string — for optimistic concurrency check. */
  snapshotId: string;
  dispatcher: StepDispatcher;
}

export interface SubmitGateOptions {
  runId: string;
  gateId: string;
  choice: string;
  snapshotId: string;
}

export interface ExecuteChainOptions {
  runId: string;
  command: string;
  input: Record<string, unknown>;
  snapshotId: string;
  dispatcher: StepDispatcher;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a promise with a timeout. If the timeout fires first, rejects with STEP_TIMEOUT.
 * NOTE: if timeout fires, the original promise continues running in the background
 * (Promises cannot be cancelled in JavaScript). Acceptable for Phase 1.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, stepName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new WorkflowError(`Step '${stepName}' timed out after ${ms}ms`, {
            code: 'STEP_TIMEOUT',
            category: 'ENGINE',
            agentAction: 'report_to_user',
            retryable: false,
            details: { stepName, timeout_ms: ms },
          }),
        ),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Computes the delay (ms) before a retry attempt based on the configured backoff strategy. */
function computeBackoff(config: RetryConfig, attemptNum: number): number {
  switch (config.backoff) {
    case 'fixed':
      return config.base_delay_ms;
    case 'linear':
      return config.base_delay_ms * attemptNum;
    case 'exponential':
      return config.base_delay_ms * Math.pow(2, attemptNum - 1);
  }
}

/**
 * Returns a NextAction for the first step that can execute from the given state,
 * or null if no step is available (terminal or stalled state).
 */
export function findNextAction(
  newState: string,
  definition: WorkflowDefinition,
): NextAction | null {
  for (const [stepName, step] of Object.entries(definition.steps)) {
    if (step.allowed_from_states.includes(newState)) {
      return {
        instruction: step.handler !== undefined
          ? { tool: step.handler, params: {} }
          : null,
        human_readable: `Execute step '${stepName}': ${step.description}`,
        context_hint: `Current state is '${newState}'. Next step is '${stepName}'.`,
        ...(step.timeout_seconds !== undefined
          ? { expected_timeout: `${step.timeout_seconds}s` }
          : {}),
      };
    }
  }
  return null;
}

/** Builds a minimal error ResponseEnvelope from primitive fields. */
function errorEnvelope(
  command: string,
  runId: string,
  snapshotId: string,
  err: WorkflowError,
): ResponseEnvelope {
  return {
    command,
    run_id: runId,
    snapshot_id: snapshotId,
    status: 'error',
    data: {},
    evidence: [],
    warnings: [],
    errors: [err.message],
    next_action: null,
  };
}

function makeErrorEnvelope(
  options: ExecuteStepOptions,
  run: RunRecord | null,
  err: WorkflowError,
): ResponseEnvelope {
  return errorEnvelope(
    options.command,
    options.runId,
    run !== null ? run.version.toString() : options.snapshotId,
    err,
  );
}

export async function executeStep(
  store: RunStore,
  guard: StateGuard,
  definition: WorkflowDefinition,
  options: ExecuteStepOptions,
): Promise<ResponseEnvelope> {
  // Step 1: Load run
  let run: RunRecord;
  try {
    run = await store.get(options.runId);
  } catch (err) {
    if (err instanceof WorkflowError) {
      return makeErrorEnvelope(options, null, err);
    }
    const internal = new WorkflowError('Failed to load run from store', {
      code: 'ENGINE_STORE_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
    return makeErrorEnvelope(options, null, internal);
  }

  // Step 2: Check snapshot_id (optimistic concurrency)
  if (options.snapshotId !== run.version.toString()) {
    const err = new WorkflowError('Snapshot mismatch — run version has changed', {
      code: 'STATE_SNAPSHOT_MISMATCH',
      category: 'STATE',
      agentAction: 'report_to_user',
      retryable: true,
      details: { expected: options.snapshotId, actual: run.version.toString() },
    });
    return makeErrorEnvelope(options, run, err);
  }

  // Step 3: Check state guard
  if (!guard.isAllowed(options.command, run.state)) {
    const blockedReason = guard.getBlockedReason(options.command, run.state);
    return {
      command: options.command,
      run_id: options.runId,
      snapshot_id: run.version.toString(),
      status: 'blocked',
      data: {},
      evidence: [],
      warnings: [],
      errors: [],
      next_action: null,
      blocked_reason: blockedReason,
    };
  }

  const stepDef = definition.steps[options.command];

  // Build evidence map once — used for precondition check and diagnostics.
  const evidenceByStep: Record<string, Record<string, unknown>> = {};
  for (const snap of run.evidence) {
    if (snap.kind === 'gate_response') continue;
    evidenceByStep[snap.step_id] = snap.output_summary;
  }

  // Step 3a: Evaluate preconditions — block the step if any expression fails.
  if (stepDef?.preconditions !== undefined && stepDef.preconditions.length > 0) {
    const failed = checkPreconditions(stepDef.preconditions, evidenceByStep);
    if (failed !== null) {
      return {
        command: options.command,
        run_id: options.runId,
        snapshot_id: run.version.toString(),
        status: 'blocked',
        data: {},
        evidence: [],
        warnings: [],
        errors: [],
        next_action: null,
        blocked_reason: {
          current_state: run.state,
          allowed_states: guard.getAllowedStates(options.command),
          suggestion: `Precondition failed: '${failed.expression}'. Resolved value: ${String(failed.resolved_value)}.`,
        },
      };
    }
  }

  // Build diagnostics metadata for every evidence snapshot produced by this step.
  const preconditionTrace = evaluateAllPreconditions(
    stepDef?.preconditions ?? [],
    evidenceByStep,
  );
  const inputTokenEstimate = Math.ceil(JSON.stringify(options.input).length / 4);

  // Step 3b: Validate input schema
  if (stepDef?.input_schema !== undefined) {
    try {
      validateInputSchema(options.input, stepDef.input_schema, options.command);
    } catch (err) {
      if (err instanceof WorkflowError) {
        return makeErrorEnvelope(options, run, err);
      }
      throw err;
    }
  }

  // Step 3c: Transition run to pending state.
  // This prevents concurrent callers from executing the same step simultaneously:
  // the first caller's store.update increments the version, causing any concurrent
  // caller (who holds the old snapshotId) to fail at step 2 (snapshot mismatch).
  let pendingRun: RunRecord;
  try {
    pendingRun = await store.update({ ...run, state: `${options.command}_pending` });
  } catch (err) {
    if (err instanceof WorkflowError) {
      return makeErrorEnvelope(options, run, err);
    }
    const internal = new WorkflowError('Failed to transition run to pending state', {
      code: 'ENGINE_STORE_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
    return makeErrorEnvelope(options, run, internal);
  }

  // Step 4: Execute dispatcher with retry loop and optional timeout.
  const retryConfig = stepDef?.retry;
  const timeoutMs =
    stepDef?.timeout_seconds !== undefined ? stepDef.timeout_seconds * 1000 : undefined;
  const maxAttempts = retryConfig?.max_attempts ?? 1;

  const allEvidence: EvidenceSnapshot[] = [];
  let output: Record<string, unknown> = {};
  let dispatchError: WorkflowError | null = null;
  let attemptsUsed = 0;

  for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
    attemptsUsed++;
    const startedAt = new Date();
    let attemptOutput: Record<string, unknown> = {};
    let attemptError: WorkflowError | null = null;

    try {
      const call = options.dispatcher(options.command, options.input, pendingRun);
      attemptOutput = timeoutMs !== undefined
        ? await withTimeout(call, timeoutMs, options.command)
        : await call;
    } catch (err) {
      if (err instanceof WorkflowError) {
        attemptError = err;
      } else {
        const message = err instanceof Error ? err.message : String(err);
        attemptError = new WorkflowError(`Dispatcher failed: ${message}`, {
          code: 'ENGINE_INTERNAL',
          category: 'ENGINE',
          agentAction: 'stop',
          retryable: false,
          stepId: options.command,
        });
      }
    }

    const completedAt = new Date();
    const baseSnap = captureEvidence({
      stepId: options.command,
      startedAt,
      completedAt,
      input: options.input,
      output: attemptOutput,
      ...(attemptError !== null ? { error: attemptError.message } : {}),
      diagnostics: {
        input_token_estimate: inputTokenEstimate,
        precondition_trace: preconditionTrace,
      },
    });
    // Annotate with attempt number when retries are configured.
    const snap: EvidenceSnapshot =
      retryConfig !== undefined ? { ...baseSnap, attempt: attemptNum } : baseSnap;
    allEvidence.push(snap);

    if (attemptError === null) {
      output = attemptOutput;
      dispatchError = null; // clear previous attempt failures on success
      break;
    }

    dispatchError = attemptError;

    const willRetry =
      retryConfig !== undefined && attemptError.retryable && attemptNum < maxAttempts;
    if (willRetry) {
      await delayMs(computeBackoff(retryConfig, attemptNum));
    } else {
      break;
    }
  }

  // If all retry attempts were consumed and the final attempt still failed,
  // upgrade to STEP_RETRY_EXHAUSTED so callers get a meaningful error code.
  if (dispatchError !== null && retryConfig !== undefined && attemptsUsed === maxAttempts) {
    const lastError = dispatchError;
    dispatchError = new WorkflowError(
      `Step '${options.command}' failed after ${maxAttempts} attempts`,
      {
        code: 'STEP_RETRY_EXHAUSTED',
        category: 'ENGINE',
        agentAction: 'report_to_user',
        retryable: false,
        details: {
          stepName: options.command,
          attempts: maxAttempts,
          lastError: lastError.message,
        },
      },
    );
  }

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

  // Step 5b: Gate check — if trust requires human confirmation, open a gate and halt.
  // The dispatcher has already run and produced output; that output becomes the gate preview
  // so a human can review what the agent/engine computed before it takes effect.
  if (stepDef!.trust === 'human_confirmed' || stepDef!.trust === 'human_reviewed') {
    const gate_id = crypto.randomUUID();
    const choicesRaw = stepDef!.input_schema?.properties?.['choice']?.enum;
    const choices = Array.isArray(choicesRaw) ? (choicesRaw as string[]) : ['approve', 'reject'];
    const step_name = options.command;

    let gateRun: RunRecord;
    try {
      gateRun = await store.update({
        ...pendingRun,
        state: 'gate_waiting',
        evidence: [...pendingRun.evidence, ...allEvidence],
        pending_gate: { gate_id, step_name, preview: output, choices, opened_at: new Date().toISOString() },
      });
    } catch (err) {
      if (err instanceof WorkflowError) {
        return makeErrorEnvelope(options, pendingRun, err);
      }
      return makeErrorEnvelope(
        options,
        pendingRun,
        new WorkflowError('Failed to open gate', {
          code: 'ENGINE_STORE_FAILED',
          category: 'ENGINE',
          agentAction: 'stop',
          retryable: false,
        }),
      );
    }

    return {
      command: options.command,
      run_id: options.runId,
      snapshot_id: gateRun.version.toString(),
      status: 'confirm_required',
      data: output,
      evidence: allEvidence,
      warnings: [],
      errors: [],
      next_action: null,
      gate: { gate_id, step_name, preview: output, choices },
    };
  }

  // Step 6: Determine new state.
  // stepDef was declared after step 3; isAllowed passed so it is defined here.
  const newState = stepDef!.produces_state;
  const isTerminal = isTerminalState(newState);

  // Step 7: Update run record
  const updatedRun: RunRecord = {
    ...pendingRun,
    state: newState,
    evidence: [...pendingRun.evidence, ...allEvidence],
    terminal_state: isTerminal,
    ...(isTerminal ? { terminal_reason: `Run reached terminal state '${newState}'` } : {}),
  };

  let savedRun: RunRecord;
  try {
    savedRun = await store.update(updatedRun);
  } catch (err) {
    if (err instanceof WorkflowError) {
      return makeErrorEnvelope(options, pendingRun, err);
    }
    const internal = new WorkflowError('Failed to persist run update', {
      code: 'ENGINE_STORE_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
    return makeErrorEnvelope(options, pendingRun, internal);
  }

  // Step 8: Build and return ResponseEnvelope
  const nextAction = isTerminal ? null : findNextAction(newState, definition);

  return {
    command: options.command,
    run_id: options.runId,
    snapshot_id: savedRun.version.toString(),
    status: 'ok',
    data: output,
    evidence: allEvidence,
    warnings: [],
    errors: [],
    next_action: nextAction,
  };
}

/**
 * Submits a human response for a gate-waiting run.
 * Validates the gate_id and choice, then advances the run to its produces_state.
 */
export async function submitHumanResponse(
  store: RunStore,
  definition: WorkflowDefinition,
  options: SubmitGateOptions,
): Promise<ResponseEnvelope> {
  // 1. Load run.
  let run: RunRecord;
  try {
    run = await store.get(options.runId);
  } catch (err) {
    const e =
      err instanceof WorkflowError
        ? err
        : new WorkflowError('Failed to load run from store', {
          code: 'ENGINE_STORE_FAILED',
          category: 'ENGINE',
          agentAction: 'stop',
          retryable: false,
        });
    return errorEnvelope('submit_gate', options.runId, options.snapshotId, e);
  }

  // Snapshot check.
  if (options.snapshotId !== run.version.toString()) {
    return errorEnvelope(
      'submit_gate',
      options.runId,
      run.version.toString(),
      new WorkflowError('Snapshot mismatch — run version has changed', {
        code: 'STATE_SNAPSHOT_MISMATCH',
        category: 'STATE',
        agentAction: 'report_to_user',
        retryable: true,
        details: { expected: options.snapshotId, actual: run.version.toString() },
      }),
    );
  }

  // 2. Check run is at a gate.
  if (run.state !== 'gate_waiting') {
    return errorEnvelope(
      'submit_gate',
      options.runId,
      run.version.toString(),
      new WorkflowError('Run is not waiting at a gate.', {
        code: 'STATE_BLOCKED',
        category: 'STATE',
        agentAction: 'report_to_user',
        retryable: false,
      }),
    );
  }

  // 3. Verify gate_id.
  if (run.pending_gate === undefined || run.pending_gate.gate_id !== options.gateId) {
    return errorEnvelope(
      'submit_gate',
      options.runId,
      run.version.toString(),
      new WorkflowError('Gate ID mismatch.', {
        code: 'STATE_BLOCKED',
        category: 'STATE',
        agentAction: 'report_to_user',
        retryable: false,
      }),
    );
  }

  // 4. Validate choice.
  if (!run.pending_gate.choices.includes(options.choice)) {
    const expected = run.pending_gate.choices.join(', ');
    return errorEnvelope(
      run.pending_gate.step_name,
      options.runId,
      run.version.toString(),
      new WorkflowError(
        `Choice '${options.choice}' is not valid. Expected one of: ${expected}`,
        {
          code: 'VALIDATION_INPUT_SCHEMA',
          category: 'VALIDATION',
          agentAction: 'report_to_user',
          retryable: false,
        },
      ),
    );
  }

  // 5. Get step definition.
  const stepDef = definition.steps[run.pending_gate.step_name]!;
  const newState = stepDef.produces_state;
  const isTerminal = isTerminalState(newState);

  // 6. Strip pending_gate and terminal_reason, then advance state.
  // Capture a gate_response evidence entry so the human's decision is permanently recorded.
  const { pending_gate: _pg, terminal_reason: _tr, ...rest } = run;

  const respondedAt = new Date();
  const gateEvidence = captureEvidence({
    stepId: run.pending_gate.step_name,
    startedAt: new Date(run.pending_gate.opened_at),
    completedAt: respondedAt,
    input: { choice: options.choice },
    output: { ...run.pending_gate.preview, choice: options.choice },
  });
  const gateSnapshot: EvidenceSnapshot = { ...gateEvidence, kind: 'gate_response' };

  let savedRun: RunRecord;
  try {
    savedRun = await store.update({
      ...rest,
      state: newState,
      terminal_state: isTerminal,
      ...(isTerminal ? { terminal_reason: `Run reached terminal state '${newState}'` } : {}),
      evidence: [...rest.evidence, gateSnapshot],
    });
  } catch (err) {
    const e =
      err instanceof WorkflowError
        ? err
        : new WorkflowError('Failed to persist gate response', {
          code: 'ENGINE_STORE_FAILED',
          category: 'ENGINE',
          agentAction: 'stop',
          retryable: false,
        });
    return errorEnvelope(run.pending_gate.step_name, options.runId, run.version.toString(), e);
  }

  // 7. Build response — merge step output with human choice for a complete data record.
  const data = { ...run.pending_gate.preview, choice: options.choice };
  const nextAction = isTerminal ? null : findNextAction(newState, definition);

  return {
    command: run.pending_gate.step_name,
    run_id: options.runId,
    snapshot_id: savedRun.version.toString(),
    status: 'ok',
    data,
    evidence: [],
    warnings: [],
    errors: [],
    next_action: nextAction,
  };
}

const MAX_CHAIN_DEPTH = 50;

async function executeChainInternal(
  store: RunStore,
  guard: StateGuard,
  definition: WorkflowDefinition,
  options: ExecuteChainOptions,
  depth: number,
): Promise<ResponseEnvelope> {
  if (depth > MAX_CHAIN_DEPTH) {
    return {
      command: options.command,
      run_id: options.runId,
      snapshot_id: options.snapshotId,
      status: 'error',
      data: {},
      evidence: [],
      warnings: [],
      errors: [
        'Auto-execution chain exceeded maximum depth (50). Possible cycle in workflow definition.',
      ],
      next_action: null,
    };
  }

  const result = await executeStep(store, guard, definition, options);

  // Stop chaining on any non-ok result (error, blocked, confirm_required, etc.).
  if (result.status !== 'ok') {
    return result;
  }

  // Load the current run to determine what step comes next.
  let run: RunRecord;
  try {
    run = await store.get(options.runId);
  } catch {
    // If we can't load the run, return the last good result — the step did complete.
    return result;
  }

  if (run.terminal_state) {
    return result;
  }

  const nextSteps = guard.getAllowedSteps(run.state);
  if (nextSteps.length === 0) {
    return result;
  }

  const nextStep = nextSteps[0]!;
  const nextStepDef = definition.steps[nextStep];

  // Only chain into 'auto' steps; stop at 'agent' steps for manual dispatch.
  if (nextStepDef?.execution !== 'auto') {
    return result;
  }

  // Recurse into the next auto step. If it has trust: human_confirmed, it will
  // open a gate and return confirm_required, which propagates back naturally.
  return executeChainInternal(
    store,
    guard,
    definition,
    {
      runId: options.runId,
      command: nextStep,
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: options.dispatcher,
    },
    depth + 1,
  );
}

/**
 * Executes a step and automatically chains into subsequent `execution: auto` steps.
 * Stops at agent steps, gate steps (returning confirm_required), errors, or terminal state.
 * The returned envelope is always from the last step executed in the chain.
 */
export async function executeChain(
  store: RunStore,
  guard: StateGuard,
  definition: WorkflowDefinition,
  options: ExecuteChainOptions,
): Promise<ResponseEnvelope> {
  return executeChainInternal(store, guard, definition, options, 0);
}

// Re-export TERMINAL_STATES so existing importers via execution-loop.js still resolve.
export { TERMINAL_STATES };
