// End-to-end tests for a full workflow run using YAML-loaded workflow definitions.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkflowFromString } from './yaml-loader.js';
import { JsonFileStore } from '../store/json-file-store.js';
import { executeStep } from '../engine/execution-loop.js';
import { ExtensionRegistry } from '../extensions/registry.js';
import type { StepHandler } from '../extensions/step-handler.js';

const WORKFLOW_YAML = `
id: e2e-test
name: E2E Test Workflow
version: 1
steps:
  step_one:
    description: First step
    execution: agent
    depends_on: []
  step_two:
    description: Second step
    execution: auto
    depends_on: [step_one]
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

  it('full 2-step run produces completed run_phase and evidence chain', async () => {
    const definition = loadWorkflowFromString(WORKFLOW_YAML);
    const dispatcher = async () => ({});

    const run0 = await store.create({
      workflowId: definition.id,
      workflowVersion: definition.version,
      params: {},
    });

    const res1 = await executeStep(store, definition, {
      runId: run0.id,
      command: 'step_one',
      input: {},
      dispatcher,
    });
    expect(res1.status).toBe('ok');

    const res2 = await executeStep(store, definition, {
      runId: run0.id,
      command: 'step_two',
      input: {},
      dispatcher,
    });
    expect(res2.status).toBe('ok');

    const finalRun = await store.get(run0.id);
    expect(finalRun.run_phase).toBe('completed');
    expect(finalRun.terminal_state).toBe(true);
    expect(finalRun.evidence).toHaveLength(2);
  });

  it('evidence entries have correct step_ids and success status', async () => {
    const definition = loadWorkflowFromString(WORKFLOW_YAML);
    const dispatcher = async () => ({});

    const run0 = await store.create({
      workflowId: definition.id,
      workflowVersion: definition.version,
      params: {},
    });

    await executeStep(store, definition, {
      runId: run0.id,
      command: 'step_one',
      input: {},
      dispatcher,
    });

    await executeStep(store, definition, {
      runId: run0.id,
      command: 'step_two',
      input: {},
      dispatcher,
    });

    const finalRun = await store.get(run0.id);
    expect(finalRun.evidence[0]?.step_id).toBe('step_one');
    expect(finalRun.evidence[0]?.status).toBe('success');
    expect(finalRun.evidence[1]?.step_id).toBe('step_two');
    expect(finalRun.evidence[1]?.status).toBe('success');
  });

  it('depends_on blocks out-of-order execution', async () => {
    const definition = loadWorkflowFromString(WORKFLOW_YAML);

    const run0 = await store.create({
      workflowId: definition.id,
      workflowVersion: definition.version,
      params: {},
    });

    // Attempt step_two before step_one — not eligible due to depends_on.
    const result = await executeStep(store, definition, {
      runId: run0.id,
      command: 'step_two',
      input: {},
      dispatcher: async () => ({}),
    });

    expect(result.status).toBe('blocked');
    expect(result.agent_action).toBe('resolve_precondition');
  });

  it('forwards step config to handler context', async () => {
    const yaml = `
id: config-flow-test
name: Config Flow
version: 1
steps:
  check:
    description: "Check config."
    execution: auto
    handler: config_capture
    depends_on: []
    config:
      my_key: my_value
`;
    const definition = loadWorkflowFromString(yaml);

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
      params: {},
    });

    await executeStep(store, definition, {
      runId: run.id,
      command: 'check',
      input: {},
      dispatcher: async () => ({}),
      registry,
    });

    expect(capturedConfig).toEqual({ my_key: 'my_value' });
  });
});
