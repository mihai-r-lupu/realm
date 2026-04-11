import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkflowFromString } from './yaml-loader.js';
import { JsonFileStore } from '../store/json-file-store.js';
import { StateGuard } from '../engine/state-guard.js';
import { executeStep } from '../engine/execution-loop.js';
import { ExtensionRegistry } from '../extensions/registry.js';
import type { StepHandler } from '../extensions/step-handler.js';

const WORKFLOW_YAML = `
id: e2e-test
name: E2E Test Workflow
version: 1
initial_state: created
steps:
  step_one:
    description: First step
    execution: agent
    allowed_from_states: [created]
    produces_state: step_one_done
  step_two:
    description: Second step
    execution: auto
    allowed_from_states: [step_one_done]
    produces_state: completed
`;

describe('workflow end-to-end', () => {
  let dir: string;
  let store: JsonFileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-e2e-'));
    store = new JsonFileStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('full 2-step run produces correct terminal state and evidence chain', async () => {
    const definition = loadWorkflowFromString(WORKFLOW_YAML);
    const guard = new StateGuard(definition);

    const run0 = await store.create({
      workflowId: definition.id,
      workflowVersion: definition.version,
      initialState: definition.initial_state,
      params: {},
    });

    const dispatcher = async () => ({});

    const res1 = await executeStep(store, guard, definition, {
      runId: run0.id,
      command: 'step_one',
      input: {},
      snapshotId: run0.version.toString(),
      dispatcher,
    });
    expect(res1.status).toBe('ok');

    const run1 = await store.get(run0.id);
    const res2 = await executeStep(store, guard, definition, {
      runId: run0.id,
      command: 'step_two',
      input: {},
      snapshotId: run1.version.toString(),
      dispatcher,
    });
    expect(res2.status).toBe('ok');

    const finalRun = await store.get(run0.id);
    expect(finalRun.state).toBe('completed');
    expect(finalRun.terminal_state).toBe(true);
    expect(finalRun.evidence).toHaveLength(2);
  });

  it('evidence entries have correct step_ids and success status', async () => {
    const definition = loadWorkflowFromString(WORKFLOW_YAML);
    const guard = new StateGuard(definition);
    const dispatcher = async () => ({});

    const run0 = await store.create({
      workflowId: definition.id,
      workflowVersion: definition.version,
      initialState: definition.initial_state,
      params: {},
    });

    await executeStep(store, guard, definition, {
      runId: run0.id,
      command: 'step_one',
      input: {},
      snapshotId: run0.version.toString(),
      dispatcher,
    });

    const run1 = await store.get(run0.id);
    await executeStep(store, guard, definition, {
      runId: run0.id,
      command: 'step_two',
      input: {},
      snapshotId: run1.version.toString(),
      dispatcher,
    });

    const finalRun = await store.get(run0.id);
    expect(finalRun.evidence[0]?.step_id).toBe('step_one');
    expect(finalRun.evidence[0]?.status).toBe('success');
    expect(finalRun.evidence[1]?.step_id).toBe('step_two');
  });

  it('StateGuard blocks out-of-order execution', async () => {
    const definition = loadWorkflowFromString(WORKFLOW_YAML);
    const guard = new StateGuard(definition);

    const run0 = await store.create({
      workflowId: definition.id,
      workflowVersion: definition.version,
      initialState: definition.initial_state,
      params: {},
    });

    const result = await executeStep(store, guard, definition, {
      runId: run0.id,
      command: 'step_two',
      input: {},
      snapshotId: run0.version.toString(),
      dispatcher: async () => ({}),
    });

    expect(result.status).toBe('blocked');
  });

  it('stale snapshotId blocks execution with mismatch error', async () => {
    const definition = loadWorkflowFromString(WORKFLOW_YAML);
    const guard = new StateGuard(definition);

    const run0 = await store.create({
      workflowId: definition.id,
      workflowVersion: definition.version,
      initialState: definition.initial_state,
      params: {},
    });

    // Execute step_one to advance version
    await executeStep(store, guard, definition, {
      runId: run0.id,
      command: 'step_one',
      input: {},
      snapshotId: run0.version.toString(),
      dispatcher: async () => ({}),
    });

    // Now try step_two with the stale snapshotId from run0
    const staleResult = await executeStep(store, guard, definition, {
      runId: run0.id,
      command: 'step_two',
      input: {},
      snapshotId: run0.version.toString(), // stale — was '0', now '1'
      dispatcher: async () => ({}),
    });

    expect(staleResult.status).toBe('error');
    expect(staleResult.errors[0]).toMatch(/mismatch/i);
  });

  it('forwards step config to handler context', async () => {
    const yaml = `
id: config-flow-test
name: Config Flow
version: 1
initial_state: idle
steps:
  check:
    description: "Check config."
    execution: auto
    handler: config_capture
    allowed_from_states: [idle]
    produces_state: completed
    config:
      my_key: my_value
`;
    const definition = loadWorkflowFromString(yaml);
    const guard = new StateGuard(definition);

    let capturedConfig: Record<string, unknown> | undefined;
    const captureHandler: StepHandler = {
      id: 'config_capture',
      async execute(_inputs, context) {
        capturedConfig = context.config;
        return { data: {} };
      },
    };

    const registry = new ExtensionRegistry();
    registry.register('handler', 'config_capture', captureHandler);

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: definition.version,
      initialState: definition.initial_state,
      params: {},
    });

    await executeStep(store, guard, definition, {
      runId: run.id,
      command: 'check',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: async () => ({}),
      registry,
    });

    expect(capturedConfig).toEqual({ my_key: 'my_value' });
  });
});
