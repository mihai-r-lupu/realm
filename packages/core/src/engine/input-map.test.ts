// Tests for input_map — static path-mapping for adapter params from run state.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeStep } from './execution-loop.js';
import { StateGuard } from './state-guard.js';
import { JsonFileStore } from '../store/json-file-store.js';
import type { WorkflowDefinition } from '../types/workflow-definition.js';
import type { StepDispatcher } from './execution-loop.js';
import { ExtensionRegistry } from '../extensions/registry.js';
import { MockAdapter } from '../adapters/mock-adapter.js';
import { vi } from 'vitest';

const noOpDispatcher: StepDispatcher = async (_step, _input, _run, _signal) => ({});

describe('input_map', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-input-map-'));
  });

  it('absent input_map — options.input passed to adapter unchanged', async () => {
    const def: WorkflowDefinition = {
      id: 'imap-wf',
      name: 'InputMap Workflow',
      version: 1,
      initial_state: 'created',
      services: { svc: { adapter: 'mock', trust: 'engine_delivered' } },
      steps: {
        fetch: {
          description: 'Fetch without input_map',
          execution: 'auto',
          allowed_from_states: ['created'],
          produces_state: 'done',
          uses_service: 'svc',
        },
      },
    };
    const adapter = new MockAdapter('mock', { fetch: { status: 200, data: { ok: true } } });
    const fetchSpy = vi.spyOn(adapter, 'fetch');
    const registry = new ExtensionRegistry();
    registry.register('adapter', 'mock', adapter);
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(def);
    const run = await store.create({
      workflowId: 'imap-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    await executeStep(store, guard, def, {
      runId: run.id,
      command: 'fetch',
      input: { doc_id: 'xyz' },
      snapshotId: run.version.toString(),
      dispatcher: noOpDispatcher,
      registry,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'fetch',
      { doc_id: 'xyz' },
      expect.any(Object),
      undefined,
    );
  });

  it('input_map from run.params', async () => {
    const def: WorkflowDefinition = {
      id: 'imap-wf',
      name: 'InputMap Workflow',
      version: 1,
      initial_state: 'created',
      services: { svc: { adapter: 'mock', trust: 'engine_delivered' } },
      steps: {
        setup: {
          description: 'Agent step that produces state',
          execution: 'agent',
          allowed_from_states: ['created'],
          produces_state: 'ready',
        },
        'call-api': {
          description: 'Auto step using run.params via input_map',
          execution: 'auto',
          allowed_from_states: ['ready'],
          produces_state: 'done',
          uses_service: 'svc',
          input_map: { repo: 'run.params.repo' },
        },
      },
    };
    const adapter = new MockAdapter('mock', { 'call-api': { status: 200, data: { result: 1 } } });
    const fetchSpy = vi.spyOn(adapter, 'fetch');
    const registry = new ExtensionRegistry();
    registry.register('adapter', 'mock', adapter);
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(def);

    // Start run with params.repo = 'acme/api'
    const run = await store.create({
      workflowId: 'imap-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: { repo: 'acme/api' },
    });

    // Execute the agent step first to advance state to 'ready'
    await executeStep(store, guard, def, {
      runId: run.id,
      command: 'setup',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: noOpDispatcher,
    });

    const updatedRun = await store.get(run.id);
    await executeStep(store, guard, def, {
      runId: updatedRun.id,
      command: 'call-api',
      input: {},
      snapshotId: updatedRun.version.toString(),
      dispatcher: noOpDispatcher,
      registry,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'call-api',
      { repo: 'acme/api' },
      expect.any(Object),
      undefined,
    );
  });

  it('input_map from context.resources (prior step output)', async () => {
    const def: WorkflowDefinition = {
      id: 'imap-wf',
      name: 'InputMap Workflow',
      version: 1,
      initial_state: 'created',
      services: { svc: { adapter: 'mock', trust: 'engine_delivered' } },
      steps: {
        step1: {
          description: 'Handler step that outputs pr_number',
          execution: 'auto',
          handler: 'make-pr',
          allowed_from_states: ['created'],
          produces_state: 'step1_done',
        },
        step2: {
          description: 'Adapter step using context.resources',
          execution: 'auto',
          allowed_from_states: ['step1_done'],
          produces_state: 'done',
          uses_service: 'svc',
          input_map: { number: 'context.resources.step1.pr_number' },
        },
      },
    };

    // Handler that returns { pr_number: 42 }
    const handler = {
      id: 'make-pr',
      async execute(_inputs: unknown, _ctx: unknown) {
        return { data: { pr_number: 42 } };
      },
    };
    const adapter = new MockAdapter('mock', { step2: { status: 200, data: { done: true } } });
    const fetchSpy = vi.spyOn(adapter, 'fetch');
    const registry = new ExtensionRegistry();
    registry.register('adapter', 'mock', adapter);
    registry.register('handler', 'make-pr', handler);
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(def);

    const run = await store.create({
      workflowId: 'imap-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    // Execute step1 (handler produces pr_number: 42 in evidence)
    await executeStep(store, guard, def, {
      runId: run.id,
      command: 'step1',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: noOpDispatcher,
      registry,
    });

    const afterStep1 = await store.get(run.id);
    await executeStep(store, guard, def, {
      runId: afterStep1.id,
      command: 'step2',
      input: {},
      snapshotId: afterStep1.version.toString(),
      dispatcher: noOpDispatcher,
      registry,
    });

    expect(fetchSpy).toHaveBeenCalledWith('step2', { number: 42 }, expect.any(Object), undefined);
  });

  it('unresolvable path produces undefined key in adapter params', async () => {
    const def: WorkflowDefinition = {
      id: 'imap-wf',
      name: 'InputMap Workflow',
      version: 1,
      initial_state: 'created',
      services: { svc: { adapter: 'mock', trust: 'engine_delivered' } },
      steps: {
        fetch: {
          description: 'Step with bad path in input_map',
          execution: 'auto',
          allowed_from_states: ['created'],
          produces_state: 'done',
          uses_service: 'svc',
          input_map: { x: 'run.params.nonexistent' },
        },
      },
    };
    const adapter = new MockAdapter('mock', { fetch: { status: 200, data: {} } });
    const fetchSpy = vi.spyOn(adapter, 'fetch');
    const registry = new ExtensionRegistry();
    registry.register('adapter', 'mock', adapter);
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(def);
    const run = await store.create({
      workflowId: 'imap-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    await executeStep(store, guard, def, {
      runId: run.id,
      command: 'fetch',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: noOpDispatcher,
      registry,
    });

    expect(fetchSpy).toHaveBeenCalledWith('fetch', { x: undefined }, expect.any(Object), undefined);
  });
});
