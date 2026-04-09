// Tests for step-level timeout, retry, pending state, and failure-terminal guarantees.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeStep } from './execution-loop.js';
import { StateGuard } from './state-guard.js';
import { JsonFileStore } from '../store/json-file-store.js';
import { WorkflowError } from '../types/workflow-error.js';
import type { WorkflowDefinition } from '../types/workflow-definition.js';
import type { StepDispatcher } from './execution-loop.js';
import { MockAdapter } from '../adapters/mock-adapter.js';

// Workflow with a single step that times out at 0.05s and allows 2 retry attempts.
const timeoutDef: WorkflowDefinition = {
  id: 'timeout-wf',
  name: 'Timeout Workflow',
  version: 1,
  initial_state: 'created',
  steps: {
    'step-one': {
      description: 'Times out',
      execution: 'auto',
      allowed_from_states: ['created'],
      produces_state: 'completed',
      timeout_seconds: 0.05,
    },
  },
};

const noTimeoutDef: WorkflowDefinition = {
  id: 'no-timeout-wf',
  name: 'No Timeout Workflow',
  version: 1,
  initial_state: 'created',
  steps: {
    'step-one': {
      description: 'Succeeds',
      execution: 'auto',
      allowed_from_states: ['created'],
      produces_state: 'completed',
    },
  },
};

const retryDef: WorkflowDefinition = {
  id: 'retry-wf',
  name: 'Retry Workflow',
  version: 1,
  initial_state: 'created',
  steps: {
    'step-one': {
      description: 'Retries',
      execution: 'auto',
      allowed_from_states: ['created'],
      produces_state: 'completed',
      retry: { max_attempts: 3, backoff: 'fixed', base_delay_ms: 10 },
    },
  },
};

function makeRetryableError(): WorkflowError {
  return new WorkflowError('transient failure', {
    code: 'ENGINE_HANDLER_FAILED',
    category: 'ENGINE',
    agentAction: 'stop',
    retryable: true,
  });
}

function makeNonRetryableError(): WorkflowError {
  return new WorkflowError('permanent failure', {
    code: 'ENGINE_HANDLER_FAILED',
    category: 'ENGINE',
    agentAction: 'stop',
    retryable: false,
  });
}

describe('reliability', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-reliability-'));
  });

  it('timeout fires — step returns error and run is marked failed', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(timeoutDef);
    const run = await store.create({
      workflowId: 'timeout-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    // Dispatcher takes 200ms; step timeout is 50ms — timeout fires first.
    const slowDispatcher: StepDispatcher = () =>
      new Promise((resolve) => setTimeout(() => resolve({}), 200));

    const envelope = await executeStep(store, guard, timeoutDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: slowDispatcher,
    });

    expect(envelope.status).toBe('error');
    expect(envelope.errors[0]).toContain('timed out');

    const updated = await store.get(run.id);
    expect(updated.state).toBe('failed');
    expect(updated.terminal_state).toBe(true);
  });

  it('step without timeout completes normally', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(noTimeoutDef);
    const run = await store.create({
      workflowId: 'no-timeout-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const fastDispatcher: StepDispatcher = async () => ({ done: true });

    const envelope = await executeStep(store, guard, noTimeoutDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: fastDispatcher,
    });

    expect(envelope.status).toBe('ok');
    const updated = await store.get(run.id);
    expect(updated.state).toBe('completed');
  });

  it('retry succeeds on 2nd attempt — evidence has 2 entries with attempt numbers', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(retryDef);
    const run = await store.create({
      workflowId: 'retry-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    let calls = 0;
    const flakyDispatcher: StepDispatcher = async () => {
      calls++;
      if (calls === 1) throw makeRetryableError();
      return { ok: true };
    };

    const envelope = await executeStep(store, guard, retryDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: flakyDispatcher,
    });

    expect(envelope.status).toBe('ok');
    expect(envelope.evidence).toHaveLength(2);
    expect(envelope.evidence[0]?.attempt).toBe(1);
    expect(envelope.evidence[0]?.status).toBe('error');
    expect(envelope.evidence[1]?.attempt).toBe(2);
    expect(envelope.evidence[1]?.status).toBe('success');
    expect(calls).toBe(2);
  });

  it('retry exhaustion — returns STEP_RETRY_EXHAUSTED and run is marked failed', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(retryDef);
    const run = await store.create({
      workflowId: 'retry-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    let calls = 0;
    const alwaysFailDispatcher: StepDispatcher = async () => {
      calls++;
      throw makeRetryableError();
    };

    const envelope = await executeStep(store, guard, retryDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: alwaysFailDispatcher,
    });

    expect(envelope.status).toBe('error');
    expect(envelope.errors[0]).toContain('failed after 3 attempts');
    expect(calls).toBe(3);

    const updated = await store.get(run.id);
    expect(updated.state).toBe('failed');
    expect(updated.terminal_state).toBe(true);
    expect(updated.evidence).toHaveLength(3);
  });

  it('non-retryable error — dispatcher called exactly once and run is failed', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(retryDef);
    const run = await store.create({
      workflowId: 'retry-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    let calls = 0;
    const permanentFailDispatcher: StepDispatcher = async () => {
      calls++;
      throw makeNonRetryableError();
    };

    const envelope = await executeStep(store, guard, retryDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: permanentFailDispatcher,
    });

    expect(envelope.status).toBe('error');
    // Non-retryable: only 1 attempt — no STEP_RETRY_EXHAUSTED upgrade.
    expect(envelope.errors[0]).toContain('permanent failure');
    expect(calls).toBe(1);
  });

  it('concurrent caller is blocked by snapshot mismatch after pending write', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(noTimeoutDef);
    const run = await store.create({
      workflowId: 'no-timeout-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    // Stale snapshotId simulates a concurrent caller who holds an old version.
    const envelope = await executeStep(store, guard, noTimeoutDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: '999',
      dispatcher: async () => ({}),
    });

    expect(envelope.status).toBe('error');
    expect(envelope.errors[0]).toContain('Snapshot mismatch');
  });

  it('pending state is written to the store while dispatcher is running', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(noTimeoutDef);
    const run = await store.create({
      workflowId: 'no-timeout-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    let dispatcherCalled!: () => void;
    const calledPromise = new Promise<void>((r) => {
      dispatcherCalled = r;
    });
    let resolveDispatcher!: (v: Record<string, unknown>) => void;

    const deferredDispatcher: StepDispatcher = async () => {
      dispatcherCalled();
      return await new Promise<Record<string, unknown>>((r) => {
        resolveDispatcher = r;
      });
    };

    const stepPromise = executeStep(store, guard, noTimeoutDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: deferredDispatcher,
    });

    // Wait until the dispatcher has been called — by that point the pending state write
    // (step 3c) has already completed.
    await calledPromise;
    const mid = await store.get(run.id);
    expect(mid.state).toBe('step-one_pending');

    resolveDispatcher({});
    const envelope = await stepPromise;
    expect(envelope.status).toBe('ok');
  });

  it('failed run is marked terminal — terminal_state is true', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(noTimeoutDef);
    const run = await store.create({
      workflowId: 'no-timeout-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const failDispatcher: StepDispatcher = async () => {
      throw makeNonRetryableError();
    };

    await executeStep(store, guard, noTimeoutDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: failDispatcher,
    });

    const updated = await store.get(run.id);
    expect(updated.terminal_state).toBe(true);
    expect(updated.state).toBe('failed');
  });

  it('AbortSignal is aborted when timeout fires', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(timeoutDef);
    const run = await store.create({
      workflowId: 'timeout-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    let capturedSignal: AbortSignal | undefined;
    const sigCapturingDispatcher: StepDispatcher = (_step, _input, _run, signal) => {
      capturedSignal = signal;
      return new Promise<Record<string, unknown>>(() => {
        /* never resolves */
      });
    };

    const envelope = await executeStep(store, guard, timeoutDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: sigCapturingDispatcher,
    });

    expect(envelope.status).toBe('error');
    expect(envelope.errors[0]).toContain('timed out');
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('MockAdapter rejects with STEP_ABORTED when signal is already aborted', async () => {
    const adapter = new MockAdapter('test', { foo: { status: 200, data: { ok: true } } });
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.fetch('foo', {}, {}, controller.signal)).rejects.toMatchObject({
      code: 'STEP_ABORTED',
      retryable: false,
    });
  });
});
