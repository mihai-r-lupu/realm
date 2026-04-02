// Central execution loop — orchestrates state guard, dispatcher, evidence capture,
// run state update, and ResponseEnvelope construction.
import type { RunRecord } from '../types/run-record.js';
import type { ResponseEnvelope, NextAction } from '../types/response-envelope.js';
import { WorkflowError } from '../types/workflow-error.js';
import type { WorkflowDefinition } from '../types/workflow-definition.js';
import type { RunStore } from '../store/store-interface.js';
import type { StateGuard } from './state-guard.js';
import { captureEvidence } from '../evidence/snapshot.js';
import { validateInputSchema } from '../validation/input-schema.js';

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

const TERMINAL_STATES = new Set(['completed', 'cancelled', 'failed', 'abandoned']);

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

  // Step 4: Execute dispatcher
  const startedAt = new Date();
  let output: Record<string, unknown>;
  let dispatchError: WorkflowError | null = null;

  try {
    output = await options.dispatcher(options.command, options.input, run);
  } catch (err) {
    if (err instanceof WorkflowError) {
      dispatchError = err;
    } else {
      const message = err instanceof Error ? err.message : String(err);
      dispatchError = new WorkflowError(`Dispatcher failed: ${message}`, {
        code: 'ENGINE_INTERNAL',
        category: 'ENGINE',
        agentAction: 'stop',
        retryable: false,
        stepId: options.command,
      });
    }
    output = {};
  }

  const completedAt = new Date();

  // Step 5: Build evidence snapshot
  const evidenceSnapshot = captureEvidence({
    stepId: options.command,
    startedAt,
    completedAt,
    input: options.input,
    output,
    ...(dispatchError !== null ? { error: dispatchError.message } : {}),
  });

  if (dispatchError !== null) {
    return {
      command: options.command,
      run_id: options.runId,
      snapshot_id: run.version.toString(),
      status: 'error',
      data: {},
      evidence: [evidenceSnapshot],
      warnings: [],
      errors: [dispatchError.message],
      next_action: null,
    };
  }

  // Step 6: Determine new state
  // stepDef was declared in Step 3b; isAllowed passed so it is defined here
  const newState = stepDef!.produces_state;
  const isTerminal = TERMINAL_STATES.has(newState);

  // Step 7: Update run record
  const updatedRun: RunRecord = {
    ...run,
    state: newState,
    evidence: [...run.evidence, evidenceSnapshot],
    terminal_state: isTerminal,
    ...(isTerminal ? { terminal_reason: `Run reached terminal state '${newState}'` } : {}),
  };

  let savedRun: RunRecord;
  try {
    savedRun = await store.update(updatedRun);
  } catch (err) {
    if (err instanceof WorkflowError) {
      return makeErrorEnvelope(options, run, err);
    }
    const internal = new WorkflowError('Failed to persist run update', {
      code: 'ENGINE_STORE_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
    return makeErrorEnvelope(options, run, internal);
  }

  // Step 8: Build and return ResponseEnvelope
  const nextAction = isTerminal ? null : findNextAction(newState, definition);

  return {
    command: options.command,
    run_id: options.runId,
    snapshot_id: savedRun.version.toString(),
    status: 'ok',
    data: output,
    evidence: [evidenceSnapshot],
    warnings: [],
    errors: [],
    next_action: nextAction,
  };
}
