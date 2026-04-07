// Central execution loop — orchestrates state guard, dispatcher, evidence capture,
// run state update, and ResponseEnvelope construction.
// Includes: pending state transitions, step-level retry, step timeouts,
// human gate mechanics, auto-chaining, precondition evaluation,
// and registry-based dispatch for adapter and handler steps.
import type { RunRecord, EvidenceSnapshot } from '../types/run-record.js';
import type { ResponseEnvelope, NextAction } from '../types/response-envelope.js';
import { WorkflowError } from '../types/workflow-error.js';
import type { WorkflowDefinition, RetryConfig, StepDefinition } from '../types/workflow-definition.js';
import type { RunStore } from '../store/store-interface.js';
import type { StateGuard } from './state-guard.js';
import { captureEvidence } from '../evidence/snapshot.js';
import { validateInputSchema } from '../validation/input-schema.js';
import { TERMINAL_STATES, isTerminalState } from './lifecycle.js';
import { checkPreconditions, evaluateAllPreconditions } from './precondition.js';
import { ExtensionRegistry } from '../extensions/registry.js';
import type { ServiceResponse } from '../extensions/service-adapter.js';
import { resolveSecret } from '../config/secrets.js';
import { resolvePromptTemplate } from './prompt-template.js';
import { generateSchemaSkeleton } from '../utils/schema-skeleton.js';

export type StepDispatcher = (
  stepName: string,
  input: Record<string, unknown>,
  run: RunRecord,
  signal?: AbortSignal,
) => Promise<Record<string, unknown>>;

export interface ExecuteStepOptions {
  runId: string;
  command: string;
  input: Record<string, unknown>;
  /** Caller's expected version string — for optimistic concurrency check. */
  snapshotId: string;
  dispatcher: StepDispatcher;
  /**
   * Extension registry for resolving service adapters and step handlers.
   * Required for auto steps that declare `uses_service` or `handler`.
   * Callers that only drive agent steps may omit this.
   */
  registry?: ExtensionRegistry;
  /** Resolved secrets passed to adapter configs (e.g. API tokens). */
  secrets?: Record<string, string>;
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
  /** @see ExecuteStepOptions.registry */
  registry?: ExtensionRegistry;
  /** @see ExecuteStepOptions.secrets */
  secrets?: Record<string, string>;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes `dispatch` with a cancellation signal. If `dispatch` does not complete within `ms`
 * milliseconds, the signal is aborted and a STEP_TIMEOUT WorkflowError is thrown. The signal
 * cancels any in-flight fetch() calls inside the dispatcher.
 */
function withTimeout<T>(
  dispatch: (signal: AbortSignal) => Promise<T>,
  ms: number,
  stepName: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new WorkflowError(`Step '${stepName}' timed out after ${ms}ms`, {
          code: 'STEP_TIMEOUT',
          category: 'ENGINE',
          agentAction: 'report_to_user',
          retryable: false,
          details: { stepName, timeout_ms: ms },
        }),
      );
    }, ms);
  });

  return Promise.race([dispatch(controller.signal), timeout]).finally(() =>
    clearTimeout(timer),
  );
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
 * Resolves and calls the service adapter for an auto step with `uses_service`.
 * Throws WorkflowError(ENGINE_ADAPTER_FAILED) if the service or adapter is not found,
 * or if the adapter throws an unexpected error.
 */
async function callAdapter(
  stepDef: StepDefinition,
  definition: WorkflowDefinition,
  options: ExecuteStepOptions,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const serviceName = stepDef.uses_service!;
  const serviceDef = definition.services?.[serviceName];
  if (serviceDef === undefined) {
    throw new WorkflowError(`Service '${serviceName}' not found in workflow definition`, {
      code: 'ENGINE_ADAPTER_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
      stepId: options.command,
    });
  }

  const adapter = options.registry?.getAdapter(serviceDef.adapter);
  if (adapter === undefined) {
    throw new WorkflowError(
      `Adapter '${serviceDef.adapter}' for service '${serviceName}' is not registered`,
      {
        code: 'ENGINE_ADAPTER_FAILED',
        category: 'ENGINE',
        agentAction: 'stop',
        retryable: false,
        stepId: options.command,
      },
    );
  }

  // Build config object, resolving any secrets.KEY references in auth.
  const secrets = options.secrets ?? {};
  const config: Record<string, unknown> = { adapter: serviceDef.adapter, trust: serviceDef.trust };
  if (serviceDef.auth?.token_from !== undefined) {
    config['auth'] = { token: resolveSecret(serviceDef.auth.token_from, secrets) };
  }

  const method = stepDef.service_method ?? 'fetch';
  const operation = stepDef.operation ?? options.command;

  let response: ServiceResponse;
  try {
    response = await adapter[method](operation, options.input, config, signal);
  } catch (err) {
    if (err instanceof WorkflowError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkflowError(`Adapter '${serviceDef.adapter}' threw: ${message}`, {
      code: 'ENGINE_ADAPTER_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
      stepId: options.command,
    });
  }

  // Unwrap ServiceResponse: surface the inner data object as the step output.
  // If data is not a plain object, wrap it to preserve the status code.
  return typeof response.data === 'object' && response.data !== null
    ? (response.data as Record<string, unknown>)
    : { data: response.data, status: response.status };
}

/**
 * Resolves and calls the step handler for an auto step with a `handler` reference.
 * The handler receives prior step outputs via context.resources so it can access
 * evidence produced by earlier steps (e.g. the document text fetched in step 1).
 * Throws WorkflowError(ENGINE_HANDLER_FAILED) if the handler is not found or throws.
 */
async function callHandler(
  stepDef: StepDefinition,
  options: ExecuteStepOptions,
  pendingRun: RunRecord,
  evidenceByStep: Record<string, Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const handlerName = stepDef.handler!;
  const handler = options.registry?.getHandler(handlerName);
  if (handler === undefined) {
    throw new WorkflowError(`Handler '${handlerName}' is not registered`, {
      code: 'ENGINE_HANDLER_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
      stepId: options.command,
    });
  }

  let result: Awaited<ReturnType<typeof handler.execute>>;
  try {
    result = await handler.execute(
      { params: options.input },
      {
        run_id: options.runId,
        run_params: pendingRun.params,
        config: {},
        // Prior step outputs are exposed as resources so the handler can access
        // document text, extracted candidates, etc. without reading the store.
        resources: evidenceByStep,
      },
      signal,
    );
  } catch (err) {
    if (err instanceof WorkflowError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkflowError(`Handler '${handlerName}' threw: ${message}`, {
      code: 'ENGINE_HANDLER_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
      stepId: options.command,
    });
  }

  return result.data;
}

/**
 * Returns a NextAction for the first step that can execute from the given state,
 * or null if no step is available (terminal or stalled state).
 * Resolves any step.prompt template references before returning.
 */
export function findNextAction(
  newState: string,
  definition: WorkflowDefinition,
  context: {
    evidenceByStep: Record<string, Record<string, unknown>>;
    runParams: Record<string, unknown>;
    runId: string;
  },
): NextAction | null {
  for (const [stepName, step] of Object.entries(definition.steps)) {
    if (step.allowed_from_states.includes(newState)) {
      const resolvedPrompt =
        step.prompt !== undefined
          ? resolvePromptTemplate(step.prompt, context)
          : undefined;
      return {
        instruction: step.handler !== undefined
          ? { tool: step.handler, params: {}, call_with: {} }
          : step.execution === 'agent'
            ? {
              tool: 'execute_step',
              params: { run_id: context.runId, command: stepName },
              call_with: {
                run_id: context.runId,
                command: stepName,
                params: step.input_schema !== undefined
                  ? generateSchemaSkeleton(step.input_schema as Record<string, unknown>)
                  : '<YOUR_PARAMS>',
              },
            }
            : null,
        ...(step.execution === 'agent' && step.input_schema !== undefined
          ? { input_schema: step.input_schema }
          : {}),
        human_readable: `Execute step '${stepName}': ${step.description}`,
        orientation: `Current state is '${newState}'. Next step is '${stepName}'.`,
        ...(step.timeout_seconds !== undefined
          ? { expected_timeout: `${step.timeout_seconds}s` }
          : {}),
        ...(resolvedPrompt !== undefined ? { prompt: resolvedPrompt } : {}),
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
  contextHint?: string,
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
    agent_action: err.agentAction,
    context_hint: contextHint ?? `Error during '${command}'.`,
    next_action: null,
  };
}

function makeErrorEnvelope(
  options: ExecuteStepOptions,
  run: RunRecord | null,
  err: WorkflowError,
  definition?: WorkflowDefinition,
): ResponseEnvelope {
  const hint = run !== null
    ? `Error during '${options.command}'. Run remains in state '${run.state}'.`
    : undefined;
  const base = errorEnvelope(
    options.command,
    options.runId,
    run !== null ? run.version.toString() : options.snapshotId,
    err,
    hint,
  );
  if (run !== null && definition !== undefined && err.agentAction !== 'stop') {
    const evidenceByStep: Record<string, Record<string, unknown>> = {};
    for (const snap of run.evidence) {
      if (snap.kind === 'gate_response') continue;
      evidenceByStep[snap.step_id] = snap.output_summary;
    }
    const next_action = findNextAction(run.state, definition, {
      evidenceByStep,
      runParams: run.params,
      runId: options.runId,
    });
    return { ...base, next_action };
  }
  return base;
}

/**
 * Validates run state, executes a single workflow step through the dispatcher with retry and timeout support, captures evidence, persists the updated run record, and returns a ResponseEnvelope containing the outcome and the next action.
 */
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
    return makeErrorEnvelope(options, run, err, definition);
  }

  // Step 3: Check state guard
  if (!guard.isAllowed(options.command, run.state)) {
    const blockedReason = guard.getBlockedReason(options.command, run.state);
    const blockedEvidence: Record<string, Record<string, unknown>> = {};
    for (const snap of run.evidence) {
      if (snap.kind === 'gate_response') continue;
      blockedEvidence[snap.step_id] = snap.output_summary;
    }
    const nextAction = findNextAction(run.state, definition, {
      evidenceByStep: blockedEvidence,
      runParams: run.params,
      runId: options.runId,
    });
    return {
      command: options.command,
      run_id: options.runId,
      snapshot_id: run.version.toString(),
      status: 'blocked',
      data: {},
      evidence: [],
      warnings: [],
      errors: [],
      agent_action: 'resolve_precondition' as const,
      context_hint: `Step '${options.command}' is not allowed in state '${run.state}'.`,
      next_action: nextAction,
      blocked_reason: nextAction !== null
        ? { ...blockedReason, suggestion: `Call the step indicated in next_action instead.` }
        : { ...blockedReason, suggestion: `No valid next step exists from state '${run.state}'.` },
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
        agent_action: 'stop' as const,
        context_hint: `Precondition failed for step '${options.command}' in state '${run.state}'.`,
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
      // validateInputSchema only throws WorkflowError — cast is safe.
      return makeErrorEnvelope(options, run, err as WorkflowError, definition);
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
      return makeErrorEnvelope(options, run, err, definition);
    }
    const internal = new WorkflowError('Failed to transition run to pending state', {
      code: 'ENGINE_STORE_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
    return makeErrorEnvelope(options, run, internal, definition);
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
      // For auto steps, resolve the correct callable from the registry.
      // For agent steps (or auto steps without a service/handler), use the caller's dispatcher.
      const makeCall = (signal?: AbortSignal): Promise<Record<string, unknown>> => {
        if (stepDef?.execution === 'auto' && stepDef.uses_service !== undefined) {
          return callAdapter(stepDef, definition, options, signal);
        } else if (stepDef?.execution === 'auto' && stepDef.handler !== undefined) {
          return callHandler(stepDef, options, pendingRun, evidenceByStep, signal);
        } else {
          return options.dispatcher(options.command, options.input, pendingRun, signal);
        }
      };
      attemptOutput = timeoutMs !== undefined
        ? await withTimeout((signal) => makeCall(signal), timeoutMs, options.command)
        : await makeCall();
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
    const profile = stepDef?.agent_profile;
    const profileData =
      profile !== undefined ? definition.resolved_profiles?.[profile] : undefined;
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
      ...(profileData !== undefined
        ? { agentProfile: profile!, agentProfileHash: profileData.content_hash }
        : {}),
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
      agent_action: 'stop' as const,
      context_hint: `Dispatch error during step '${options.command}'. Run remains in state '${pendingRun.state}'.`,
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
        return makeErrorEnvelope(options, pendingRun, err, definition);
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
        definition,
      );
    }

    // Resolve gate display (from step.prompt) and agent_hint (from step.instructions) with full evidence context.
    const gateEvidenceCtx = { ...evidenceByStep, [options.command]: output };
    const resolvedGateDisplay =
      stepDef!.prompt !== undefined
        ? resolvePromptTemplate(stepDef!.prompt, {
          evidenceByStep: gateEvidenceCtx,
          runParams: run.params,
        })
        : undefined;
    const resolvedGateInstructions =
      stepDef!.instructions !== undefined
        ? resolvePromptTemplate(stepDef!.instructions, {
          evidenceByStep: gateEvidenceCtx,
          runParams: run.params,
        })
        : undefined;

    return {
      command: options.command,
      run_id: options.runId,
      snapshot_id: gateRun.version.toString(),
      status: 'confirm_required',
      data: output,
      evidence: allEvidence,
      warnings: [],
      errors: [],
      context_hint: `Run is paused at gate '${gate_id}'. Available choices: ${choices.join(', ')}.`,
      next_action: {
        instruction: {
          tool: 'submit_human_response',
          params: { run_id: options.runId, gate_id },
          call_with: {
            run_id: options.runId,
            gate_id,
            choice: `<${choices.join('|')}>`,
          },
        },
        human_readable: `Human review required for step '${options.command}'. Present gate.display to the user, wait for their choice from gate.response_spec.choices, then call submit_human_response.`,
        orientation: `Run is paused at gate '${gate_id}'. Available choices: ${choices.join(', ')}.`,
      },
      gate: {
        gate_id,
        step_name,
        preview: output,
        choices,
        ...(resolvedGateDisplay !== undefined ? { display: resolvedGateDisplay } : {}),
        ...(resolvedGateInstructions !== undefined ? { agent_hint: resolvedGateInstructions } : {}),
        response_spec: { choices },
      },
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
      return makeErrorEnvelope(options, pendingRun, err, definition);
    }
    const internal = new WorkflowError('Failed to persist run update', {
      code: 'ENGINE_STORE_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
    return makeErrorEnvelope(options, pendingRun, internal, definition);
  }

  // Step 8: Build and return ResponseEnvelope
  // Include the current step's output in evidenceByStep for the next step's prompt template.
  const nextStepContext = {
    evidenceByStep: { ...evidenceByStep, [options.command]: output },
    runParams: run.params,
  };
  const nextAction = isTerminal ? null : findNextAction(newState, definition, { ...nextStepContext, runId: options.runId });

  return {
    command: options.command,
    run_id: options.runId,
    snapshot_id: savedRun.version.toString(),
    status: 'ok',
    data: output,
    evidence: allEvidence,
    warnings: [],
    errors: [],
    context_hint: nextAction !== null
      ? nextAction.orientation
      : `Run completed in terminal state '${newState}'. Call get_run_state with run_id '${options.runId}' to retrieve the full evidence record.`,
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
      `Snapshot mismatch in gate handling. Run is in state '${run.state}'.`,
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
      `Submit failed — run is in state '${run.state}', not 'gate_waiting'.`,
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
      `Gate ID mismatch. Run is still in state '${run.state}'.`,
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
      `Invalid choice for gate '${run.pending_gate.step_name}'. Run is in state '${run.state}'.`,
    );
  }

  // 5. Get step definition and check for gate-response transition.
  const gateStepName = run.pending_gate.step_name;
  const stepDef = definition.steps[gateStepName]!;
  const transitionKey = `on_${options.choice}`;
  const transition = stepDef.transitions?.[transitionKey];
  const newState = transition !== undefined ? transition.produces_state : stepDef.produces_state;
  const isTerminal = transition !== undefined ? false : isTerminalState(stepDef.produces_state);

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
    return errorEnvelope(gateStepName, options.runId, run.version.toString(), e, `Failed to persist gate response. Run was in state '${run.state}'.`);
  }

  // 7. Build response — merge step output with human choice for a complete data record.
  const data = { ...run.pending_gate.preview, choice: options.choice };
  // Build evidenceByStep from the saved run for next step's prompt template resolution.
  const evidenceByStep: Record<string, Record<string, unknown>> = {};
  for (const snap of savedRun.evidence) {
    if (snap.kind === 'gate_response') continue;
    evidenceByStep[snap.step_id] = snap.output_summary;
  }
  const nextAction = isTerminal
    ? null
    : findNextAction(newState, definition, {
      evidenceByStep,
      runParams: savedRun.params,
      runId: options.runId,
    });

  return {
    command: gateStepName,
    run_id: options.runId,
    snapshot_id: savedRun.version.toString(),
    status: 'ok',
    data,
    evidence: [],
    warnings: [],
    errors: [],
    context_hint: nextAction !== null
      ? nextAction.orientation
      : `Run completed in terminal state '${newState}'. Call get_run_state with run_id '${options.runId}' to retrieve the full evidence record.`,
    next_action: nextAction,
    ...(transition !== undefined ? {
      chained_auto_steps: [{ step: gateStepName, produced_state: newState, branched_via: transitionKey }],
    } : {}),
  };
}

const MAX_CHAIN_DEPTH = 50;

async function executeChainInternal(
  store: RunStore,
  guard: StateGuard,
  definition: WorkflowDefinition,
  options: ExecuteChainOptions,
  depth: number,
  chainedSteps: Array<{ step: string; produced_state: string; branched_via?: string }>,
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
      agent_action: 'stop' as const,
      context_hint: `Auto-step chain exceeded depth limit (50) for run '${options.runId}'.`,
      next_action: null,
    };
  }

  const result = await executeStep(store, guard, definition, options);

  // Stop chaining on any non-ok result (error, blocked, confirm_required, etc.).
  if (result.status !== 'ok') {
    // Check for on_error transition when the step failed.
    if (result.status === 'error') {
      const stepDef = definition.steps[options.command];
      const onError = stepDef?.transitions?.['on_error'];
      if (onError !== undefined) {
        const warningMessage = `Step '${options.command}' failed: ${result.errors[0] ?? 'unknown error'}. Routed to '${onError.step}' via on_error transition.`;
        // Load the failed run (terminal state) and transition to the branch intermediate state.
        const failedRun = await store.get(options.runId);
        const { terminal_reason: _tr, ...runBase } = failedRun;
        const savedBranchRun = await store.update({
          ...runBase,
          state: onError.produces_state,
          terminal_state: false,
        });
        // Record the branch hop in the accumulator.
        chainedSteps.push({
          step: options.command,
          produced_state: onError.produces_state,
          branched_via: 'on_error',
        });
        const recoveryStepDef = definition.steps[onError.step];
        if (recoveryStepDef?.execution === 'auto') {
          // Auto recovery step — chain continues through it.
          const branchResult = await executeChainInternal(
            store, guard, definition,
            {
              runId: options.runId,
              command: onError.step,
              input: {},
              snapshotId: savedBranchRun.version.toString(),
              dispatcher: options.dispatcher,
              ...(options.registry !== undefined ? { registry: options.registry } : {}),
              ...(options.secrets !== undefined ? { secrets: options.secrets } : {}),
            },
            depth + 1,
            chainedSteps,
          );
          return {
            ...branchResult,
            warnings: [warningMessage, ...branchResult.warnings],
          };
        } else {
          // Agent (or undefined) recovery step — stop chain and return next_action pointing at it.
          const evidenceByStep: Record<string, Record<string, unknown>> = {};
          for (const snap of savedBranchRun.evidence) {
            if (snap.kind === 'gate_response') continue;
            evidenceByStep[snap.step_id] = snap.output_summary;
          }
          const nextAction = findNextAction(onError.produces_state, definition, {
            evidenceByStep,
            runParams: savedBranchRun.params,
            runId: options.runId,
          });
          return {
            command: options.command,
            run_id: options.runId,
            snapshot_id: savedBranchRun.version.toString(),
            status: 'ok',
            data: {},
            evidence: result.evidence,
            warnings: [warningMessage],
            errors: [],
            context_hint: nextAction?.orientation ?? `Branched via on_error to '${onError.step}'.`,
            next_action: nextAction,
          };
        }
      }
    }
    return result;
  }

  // Record this step in the accumulator so callers know what ran silently.
  const currentStepDef = definition.steps[options.command];
  if (currentStepDef?.execution === 'auto') {
    chainedSteps.push({ step: options.command, produced_state: currentStepDef.produces_state });
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
    chainedSteps,
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
  const chained: Array<{ step: string; produced_state: string; branched_via?: string }> = [];
  const result = await executeChainInternal(store, guard, definition, options, 0, chained);
  const envelope = { ...result, command: options.command };
  return chained.length > 0 ? { ...envelope, chained_auto_steps: chained } : envelope;
}

// Re-export TERMINAL_STATES so existing importers via execution-loop.js still resolve.
export { TERMINAL_STATES };
