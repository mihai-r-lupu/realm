// Central execution loop — orchestrates state guard, dispatcher, evidence capture,
// run state update, and ResponseEnvelope construction.
// Includes: pending state transitions, step-level retry, step timeouts.
import type { RunRecord, EvidenceSnapshot } from '../types/run-record.js';
import type { ResponseEnvelope, NextAction } from '../types/response-envelope.js';
import { WorkflowError } from '../types/workflow-error.js';
import type { WorkflowDefinition, RetryConfig } from '../types/workflow-definition.js';
import type { RunStore } from '../store/store-interface.js';
import type { StateGuard } from './state-guard.js';
import { captureEvidence } from '../evidence/snapshot.js';
import { validateInputSchema } from '../validation/input-schema.js';
import { TERMINAL_STATES, isTerminalState } from './lifecycle.js';

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

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a promise with a timeout. If the timeout fires first, rejects with STEP_TIMEOUT.
 * NOTE: if timeout fires, the original promise continues running in the background
 * (Promises cannot be cancelled in JavaScript). This is acceptable for Phase 1.
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

function findNextAction(
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

function makeErrorEnvelope(
  options: ExecuteStepOptions,
  run: RunRecord | null,
  err: WorkflowError,
): ResponseEnvelope {
  return {
    command: options.command,
    run_id: options.runId,
    snapshot_id: run !== null ? run.version.toString() : options.snapshotId,
    status: 'error',
    data: {},
    evidence: [],
    warnings: [],
    errors: [err.message],
    next_action: null,
  };
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

  // Step 3b: Validate input schema
  const stepDef = definition.steps[options.command];
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

  // Step 6: Determine new state
  // stepDef was declared in step 3b; isAllowed passed so it is defined here.
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

// Re-export TERMINAL_STATES so existing importers via execution-loop.js still resolve.
export { TERMINAL_STATES };
