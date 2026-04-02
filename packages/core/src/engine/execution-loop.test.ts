import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeStep } from './execution-loop.js';
import { StateGuard } from './state-guard.js';
import { JsonFileStore } from '../store/json-file-store.js';
import { WorkflowError } from '../types/workflow-error.js';
import type { WorkflowDefinition } from '../types/workflow-definition.js';
import type { StepDispatcher } from './execution-loop.js';

const definition: WorkflowDefinition = {
  id: 'test-wf',
  name: 'Test Workflow',
  version: 1,
  initial_state: 'created',
  steps: {
    'step-one': {
      description: 'First step',
      execution: 'auto',
      allowed_from_states: ['created'],
      produces_state: 'step_one_done',
    },
    'step-two': {
      description: 'Second step',
      execution: 'agent',
      allowed_from_states: ['step_one_done'],
      produces_state: 'completed',
    },
  },
};

const echoDispatcher: StepDispatcher = async (_step, input) => ({ ...input, echoed: true });
const failDispatcher: StepDispatcher = async () => {
  throw new WorkflowError('step failed', {
    code: 'ENGINE_HANDLER_FAILED',
    category: 'ENGINE',
    agentAction: 'stop',
    retryable: false,
  });
};

describe('executeStep', () => {
  let store: JsonFileStore;
  let guard: StateGuard;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-exec-test-'));
    store = new JsonFileStore(dir);
    guard = new StateGuard(definition);
  });

  it('successful step returns status ok and updates run state', async () => {
    const run = await store.create({
      workflowId: 'test-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const envelope = await executeStep(store, guard, definition, {
      runId: run.id,
      command: 'step-one',
      input: { key: 'value' },
      snapshotId: '0',
      dispatcher: echoDispatcher,
    });

    expect(envelope.status).toBe('ok');
    expect(envelope.data).toMatchObject({ key: 'value', echoed: true });
    expect(envelope.evidence).toHaveLength(1);
    expect(envelope.evidence[0]?.status).toBe('success');
    expect(envelope.next_action).not.toBeNull();
    expect(envelope.next_action?.human_readable).toContain('step-two');

    const updated = await store.get(run.id);
    expect(updated.state).toBe('step_one_done');
  });

  it('snapshot mismatch returns error envelope', async () => {
    const run = await store.create({
      workflowId: 'test-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const envelope = await executeStep(store, guard, definition, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: '999',
      dispatcher: echoDispatcher,
    });

    expect(envelope.status).toBe('error');
    expect(envelope.errors[0]).toContain('Snapshot mismatch');
  });

  it('blocked state returns blocked envelope with blocked_reason', async () => {
    const run = await store.create({
      workflowId: 'test-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const envelope = await executeStep(store, guard, definition, {
      runId: run.id,
      command: 'step-two',
      input: {},
      snapshotId: '0',
      dispatcher: echoDispatcher,
    });

    expect(envelope.status).toBe('blocked');
    expect(envelope.blocked_reason).toBeDefined();
    expect(envelope.blocked_reason?.current_state).toBe('created');
    expect(envelope.blocked_reason?.allowed_states).toContain('step_one_done');
  });

  it('dispatcher error returns error envelope with evidence', async () => {
    const run = await store.create({
      workflowId: 'test-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const envelope = await executeStep(store, guard, definition, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: '0',
      dispatcher: failDispatcher,
    });

    expect(envelope.status).toBe('error');
    expect(envelope.evidence).toHaveLength(1);
    expect(envelope.evidence[0]?.status).toBe('error');
    expect(envelope.errors[0]).toContain('step failed');
  });

  it('completing final step sets terminal_state true', async () => {
    const run = await store.create({
      workflowId: 'test-wf',
      workflowVersion: 1,
      initialState: 'step_one_done',
      params: {},
    });

    const envelope = await executeStep(store, guard, definition, {
      runId: run.id,
      command: 'step-two',
      input: {},
      snapshotId: '0',
      dispatcher: echoDispatcher,
    });

    expect(envelope.status).toBe('ok');
    expect(envelope.next_action).toBeNull();

    const updated = await store.get(run.id);
    expect(updated.state).toBe('completed');
    expect(updated.terminal_state).toBe(true);
  });

  it('unknown run ID returns error envelope', async () => {
    const envelope = await executeStep(store, guard, definition, {
      runId: 'does-not-exist',
      command: 'step-one',
      input: {},
      snapshotId: '0',
      dispatcher: echoDispatcher,
    });

    expect(envelope.status).toBe('error');
    expect(envelope.errors[0]).toContain('Run not found');
  });

  it('input schema validation blocks dispatch when input is invalid', async () => {
    const dispatchCalled = vi.fn();
    const spy: StepDispatcher = async (step, input, run) => {
      dispatchCalled();
      return echoDispatcher(step, input, run);
    };

    const schemaDefinition = {
      ...definition,
      steps: {
        ...definition.steps,
        'step-one': {
          ...definition.steps['step-one']!,
          input_schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        },
      },
    };
    const schemaGuard = new StateGuard(schemaDefinition);
    const run = await store.create({
      workflowId: 'test-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const envelope = await executeStep(store, schemaGuard, schemaDefinition, {
      runId: run.id,
      command: 'step-one',
      input: {}, // missing required 'name' field
      snapshotId: '0',
      dispatcher: spy,
    });

    expect(envelope.status).toBe('error');
    expect(dispatchCalled).not.toHaveBeenCalled();
  });

  it('input schema validation passes through for valid input', async () => {
    const schemaDefinition = {
      ...definition,
      steps: {
        ...definition.steps,
        'step-one': {
          ...definition.steps['step-one']!,
          input_schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        },
      },
    };
    const schemaGuard = new StateGuard(schemaDefinition);
    const run = await store.create({
      workflowId: 'test-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const envelope = await executeStep(store, schemaGuard, schemaDefinition, {
      runId: run.id,
      command: 'step-one',
      input: { name: 'Alice' },
      snapshotId: '0',
      dispatcher: echoDispatcher,
    });

    expect(envelope.status).toBe('ok');
  });

  // Cleanup
  it('cleanup', async () => {
    await rm(dir, { recursive: true, force: true });
  });
});
