// Tests for input_map — static path-mapping for adapter params from run state.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeStep } from './execution-loop.js';
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
      services: { svc: { adapter: 'mock', trust: 'engine_delivered' } },
      steps: {
        fetch: {
          description: 'Fetch without input_map',
          execution: 'auto',
          depends_on: [],
          uses_service: 'svc',
        },
      },
    };
    const adapter = new MockAdapter('mock', { fetch: { status: 200, data: { ok: true } } });
    const fetchSpy = vi.spyOn(adapter, 'fetch');
    const registry = new ExtensionRegistry();
    registry.register('adapter', 'mock', adapter);
    const store = new JsonFileStore(dir);
    const run = await store.create({
      workflowId: 'imap-wf',
      workflowVersion: 1,
      params: {},
    });

    await executeStep(store, def, {
      runId: run.id,
      command: 'fetch',
      input: { doc_id: 'xyz' },
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
      services: { svc: { adapter: 'mock', trust: 'engine_delivered' } },
      steps: {
        setup: {
          description: 'Agent step that produces state',
          execution: 'agent',
          depends_on: [],
        },
        'call-api': {
          description: 'Auto step using run.params via input_map',
          execution: 'auto',
          depends_on: ['setup'],
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

    // Start run with params.repo = 'acme/api'
    const run = await store.create({
      workflowId: 'imap-wf',
      workflowVersion: 1,
      params: { repo: 'acme/api' },
    });

    // Execute the agent step first to advance state to 'ready'
    await executeStep(store, def, {
      runId: run.id,
      command: 'setup',
      input: {},
      dispatcher: noOpDispatcher,
    });

    const updatedRun = await store.get(run.id);
    await executeStep(store, def, {
      runId: updatedRun.id,
      command: 'call-api',
      input: {},
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
      services: { svc: { adapter: 'mock', trust: 'engine_delivered' } },
      steps: {
        step1: {
          description: 'Handler step that outputs pr_number',
          execution: 'auto',
          handler: 'make-pr',
          depends_on: [],
        },
        step2: {
          description: 'Adapter step using context.resources',
          execution: 'auto',
          depends_on: ['step1'],
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

    const run = await store.create({
      workflowId: 'imap-wf',
      workflowVersion: 1,
      params: {},
    });

    // Execute step1 (handler produces pr_number: 42 in evidence)
    await executeStep(store, def, {
      runId: run.id,
      command: 'step1',
      input: {},
      dispatcher: noOpDispatcher,
      registry,
    });

    const afterStep1 = await store.get(run.id);
    await executeStep(store, def, {
      runId: afterStep1.id,
      command: 'step2',
      input: {},
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
      services: { svc: { adapter: 'mock', trust: 'engine_delivered' } },
      steps: {
        fetch: {
          description: 'Step with bad path in input_map',
          execution: 'auto',
          depends_on: [],
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
    const run = await store.create({
      workflowId: 'imap-wf',
      workflowVersion: 1,
      params: {},
    });

    await executeStep(store, def, {
      runId: run.id,
      command: 'fetch',
      input: {},
      dispatcher: noOpDispatcher,
      registry,
    });

    expect(fetchSpy).toHaveBeenCalledWith('fetch', { x: undefined }, expect.any(Object), undefined);
  });
});
