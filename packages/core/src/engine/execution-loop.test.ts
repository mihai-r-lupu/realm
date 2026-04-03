import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeStep } from './execution-loop.js';
import { StateGuard } from './state-guard.js';
import { JsonFileStore } from '../store/json-file-store.js';
import { WorkflowError } from '../types/workflow-error.js';
import { ExtensionRegistry } from '../extensions/registry.js';
import type { WorkflowDefinition } from '../types/workflow-definition.js';
import type { StepDispatcher } from './execution-loop.js';
import type { ServiceAdapter } from '../extensions/service-adapter.js';
import type { StepHandler, StepHandlerInputs, StepContext } from '../extensions/step-handler.js';

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

  // ---------------------------------------------------------------------------
  // Adapter dispatch (uses_service)
  // ---------------------------------------------------------------------------

  describe('adapter dispatch via uses_service', () => {
    const adapterDefinition: WorkflowDefinition = {
      id: 'adapter-wf',
      name: 'Adapter Workflow',
      version: 1,
      initial_state: 'created',
      services: {
        my_service: { adapter: 'mock_adapter', trust: 'engine_delivered' },
      },
      steps: {
        fetch_data: {
          description: 'Fetch data from a service',
          execution: 'auto',
          allowed_from_states: ['created'],
          produces_state: 'fetched',
          uses_service: 'my_service',
        },
      },
    };
    const adapterGuard = new StateGuard(adapterDefinition);

    function makeAdapter(data: Record<string, unknown>): ServiceAdapter {
      return {
        id: 'mock_adapter',
        fetch: vi.fn().mockResolvedValue({ status: 200, data }),
        create: vi.fn(),
        update: vi.fn(),
      };
    }

    it('calls the registered adapter and returns its data as step output', async () => {
      const adapter = makeAdapter({ content: 'hello' });
      const registry = new ExtensionRegistry();
      registry.register('adapter', 'mock_adapter', adapter);

      const run = await store.create({
        workflowId: 'adapter-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      const envelope = await executeStep(store, adapterGuard, adapterDefinition, {
        runId: run.id,
        command: 'fetch_data',
        input: { doc_id: 'abc' },
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      expect(envelope.status).toBe('ok');
      expect(envelope.data).toEqual({ content: 'hello' });
      expect(adapter.fetch).toHaveBeenCalledWith(
        'fetch_data',
        { doc_id: 'abc' },
        expect.objectContaining({ adapter: 'mock_adapter' }),
      );
    });

    it('returns error envelope when service is not declared in definition', async () => {
      const badDefinition: WorkflowDefinition = {
        id: 'adapter-wf',
        name: 'Adapter Workflow',
        version: 1,
        initial_state: 'created',
        // no services block
        steps: {
          fetch_data: {
            description: 'Fetch data from a service',
            execution: 'auto',
            allowed_from_states: ['created'],
            produces_state: 'fetched',
            uses_service: 'my_service',
          },
        },
      };
      const badGuard = new StateGuard(badDefinition);
      const registry = new ExtensionRegistry();

      const run = await store.create({
        workflowId: 'adapter-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      const envelope = await executeStep(store, badGuard, badDefinition, {
        runId: run.id,
        command: 'fetch_data',
        input: {},
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      expect(envelope.status).toBe('error');
      expect(envelope.errors[0]).toContain("Service 'my_service' not found");
    });

    it('returns error envelope when adapter is not registered in the registry', async () => {
      const registry = new ExtensionRegistry(); // empty — no adapter registered

      const run = await store.create({
        workflowId: 'adapter-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      const envelope = await executeStep(store, adapterGuard, adapterDefinition, {
        runId: run.id,
        command: 'fetch_data',
        input: {},
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      expect(envelope.status).toBe('error');
      expect(envelope.errors[0]).toContain("Adapter 'mock_adapter'");
      expect(envelope.errors[0]).toContain('not registered');
    });

    it('wraps non-object adapter response in { data, status }', async () => {
      const adapter = makeAdapter('raw string' as unknown as Record<string, unknown>);
      const registry = new ExtensionRegistry();
      registry.register('adapter', 'mock_adapter', adapter);

      const run = await store.create({
        workflowId: 'adapter-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      const envelope = await executeStep(store, adapterGuard, adapterDefinition, {
        runId: run.id,
        command: 'fetch_data',
        input: {},
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      expect(envelope.status).toBe('ok');
      expect(envelope.data).toEqual({ data: 'raw string', status: 200 });
    });

    it('defaults to fetch when service_method is absent', async () => {
      const adapter = makeAdapter({ result: 1 });
      const registry = new ExtensionRegistry();
      registry.register('adapter', 'mock_adapter', adapter);

      const run = await store.create({
        workflowId: 'adapter-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      await executeStep(store, adapterGuard, adapterDefinition, {
        runId: run.id,
        command: 'fetch_data',
        input: {},
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      expect(adapter.fetch).toHaveBeenCalledTimes(1);
      expect(adapter.create).not.toHaveBeenCalled();
      expect(adapter.update).not.toHaveBeenCalled();
    });

    it('calls adapter.create() when service_method is create', async () => {
      const adapter: ServiceAdapter = {
        id: 'mock_adapter',
        fetch: vi.fn().mockResolvedValue({ status: 200, data: {} }),
        create: vi.fn().mockResolvedValue({ status: 201, data: { id: 'new-1' } }),
        update: vi.fn().mockResolvedValue({ status: 200, data: {} }),
      };
      const registry = new ExtensionRegistry();
      registry.register('adapter', 'mock_adapter', adapter);

      const def: WorkflowDefinition = {
        ...adapterDefinition,
        steps: {
          fetch_data: {
            ...adapterDefinition.steps['fetch_data']!,
            service_method: 'create',
          },
        },
      };
      const g = new StateGuard(def);

      const run = await store.create({
        workflowId: 'adapter-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      const envelope = await executeStep(store, g, def, {
        runId: run.id,
        command: 'fetch_data',
        input: {},
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      expect(envelope.status).toBe('ok');
      expect(adapter.create).toHaveBeenCalledTimes(1);
      expect(adapter.fetch).not.toHaveBeenCalled();
    });

    it('calls adapter.update() when service_method is update', async () => {
      const adapter: ServiceAdapter = {
        id: 'mock_adapter',
        fetch: vi.fn().mockResolvedValue({ status: 200, data: {} }),
        create: vi.fn().mockResolvedValue({ status: 201, data: {} }),
        update: vi.fn().mockResolvedValue({ status: 200, data: { updated: true } }),
      };
      const registry = new ExtensionRegistry();
      registry.register('adapter', 'mock_adapter', adapter);

      const def: WorkflowDefinition = {
        ...adapterDefinition,
        steps: {
          fetch_data: {
            ...adapterDefinition.steps['fetch_data']!,
            service_method: 'update',
          },
        },
      };
      const g = new StateGuard(def);

      const run = await store.create({
        workflowId: 'adapter-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      const envelope = await executeStep(store, g, def, {
        runId: run.id,
        command: 'fetch_data',
        input: {},
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      expect(envelope.status).toBe('ok');
      expect(adapter.update).toHaveBeenCalledTimes(1);
      expect(adapter.fetch).not.toHaveBeenCalled();
    });

    it('uses step name as operation when operation field is absent', async () => {
      const adapter = makeAdapter({ ok: true });
      const registry = new ExtensionRegistry();
      registry.register('adapter', 'mock_adapter', adapter);

      const run = await store.create({
        workflowId: 'adapter-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      await executeStep(store, adapterGuard, adapterDefinition, {
        runId: run.id,
        command: 'fetch_data',
        input: {},
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      expect(adapter.fetch).toHaveBeenCalledWith(
        'fetch_data',
        expect.anything(),
        expect.anything(),
      );
    });

    it('uses operation field when present instead of step name', async () => {
      const adapter = makeAdapter({ ok: true });
      const registry = new ExtensionRegistry();
      registry.register('adapter', 'mock_adapter', adapter);

      const def: WorkflowDefinition = {
        ...adapterDefinition,
        steps: {
          fetch_data: {
            ...adapterDefinition.steps['fetch_data']!,
            operation: 'fetch_document_v2',
          },
        },
      };
      const g = new StateGuard(def);

      const run = await store.create({
        workflowId: 'adapter-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      await executeStep(store, g, def, {
        runId: run.id,
        command: 'fetch_data',
        input: {},
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      expect(adapter.fetch).toHaveBeenCalledWith(
        'fetch_document_v2',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Handler dispatch (handler field)
  // ---------------------------------------------------------------------------

  describe('handler dispatch via handler field', () => {
    const handlerDefinition: WorkflowDefinition = {
      id: 'handler-wf',
      name: 'Handler Workflow',
      version: 1,
      initial_state: 'created',
      steps: {
        validate: {
          description: 'Run custom validation logic',
          execution: 'auto',
          allowed_from_states: ['created'],
          produces_state: 'validated',
          handler: 'my_handler',
        },
      },
    };
    const handlerGuard = new StateGuard(handlerDefinition);

    function makeHandler(data: Record<string, unknown>): StepHandler {
      return {
        id: 'my_handler',
        execute: vi.fn<[StepHandlerInputs, StepContext], Promise<{ data: Record<string, unknown> }>>()
          .mockResolvedValue({ data }),
      };
    }

    it('calls the registered handler and returns its data as step output', async () => {
      const handler = makeHandler({ valid: true });
      const registry = new ExtensionRegistry();
      registry.register('handler', 'my_handler', handler);

      const run = await store.create({
        workflowId: 'handler-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: { source: 'doc-1' },
      });

      const envelope = await executeStep(store, handlerGuard, handlerDefinition, {
        runId: run.id,
        command: 'validate',
        input: { threshold: 0.9 },
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      expect(envelope.status).toBe('ok');
      expect(envelope.data).toEqual({ valid: true });
      expect(handler.execute).toHaveBeenCalledWith(
        { params: { threshold: 0.9 } },
        expect.objectContaining({
          run_id: run.id,
          run_params: { source: 'doc-1' },
        }),
      );
    });

    it('returns error envelope when handler is not registered', async () => {
      const registry = new ExtensionRegistry(); // empty

      const run = await store.create({
        workflowId: 'handler-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      const envelope = await executeStep(store, handlerGuard, handlerDefinition, {
        runId: run.id,
        command: 'validate',
        input: {},
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      expect(envelope.status).toBe('error');
      expect(envelope.errors[0]).toContain("Handler 'my_handler' is not registered");
    });

    it('passes prior step outputs as context.resources to the handler', async () => {
      // Two-step workflow: first step uses adapter, second uses handler.
      // We run only the handler step here and verify resources are populated
      // by pre-populating the run store's evidence through a first step execution.
      const twoStepDefinition: WorkflowDefinition = {
        id: 'two-step-wf',
        name: 'Two Step Workflow',
        version: 1,
        initial_state: 'created',
        services: {
          docs: { adapter: 'mock_adapter', trust: 'engine_delivered' },
        },
        steps: {
          fetch_doc: {
            description: 'Fetch document',
            execution: 'auto',
            allowed_from_states: ['created'],
            produces_state: 'fetched',
            uses_service: 'docs',
          },
          run_validation: {
            description: 'Validate fetched document',
            execution: 'auto',
            allowed_from_states: ['fetched'],
            produces_state: 'done',
            handler: 'my_handler',
          },
        },
      };
      const twoStepGuard = new StateGuard(twoStepDefinition);

      const capturedContext: StepContext[] = [];
      const handler: StepHandler = {
        id: 'my_handler',
        execute: vi.fn().mockImplementation(async (_inputs: StepHandlerInputs, ctx: StepContext) => {
          capturedContext.push(ctx);
          return { data: { captured: true } };
        }),
      };

      const adapter: ServiceAdapter = {
        id: 'mock_adapter',
        fetch: vi.fn().mockResolvedValue({ status: 200, data: { text: 'document content' } }),
        create: vi.fn(),
        update: vi.fn(),
      };

      const registry = new ExtensionRegistry();
      registry.register('adapter', 'mock_adapter', adapter);
      registry.register('handler', 'my_handler', handler);

      const run = await store.create({
        workflowId: 'two-step-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      // Execute the adapter step first so its evidence is stored.
      await executeStep(store, twoStepGuard, twoStepDefinition, {
        runId: run.id,
        command: 'fetch_doc',
        input: {},
        snapshotId: '0',
        dispatcher: echoDispatcher,
        registry,
      });

      const updatedRun = await store.get(run.id);

      await executeStep(store, twoStepGuard, twoStepDefinition, {
        runId: run.id,
        command: 'run_validation',
        input: {},
        snapshotId: updatedRun.version.toString(),
        dispatcher: echoDispatcher,
        registry,
      });

      expect(capturedContext).toHaveLength(1);
      const ctx = capturedContext[0]!;
      expect(ctx.resources).toBeDefined();
      // The adapter step's output_summary should be available under 'fetch_doc'.
      expect(ctx.resources!['fetch_doc']).toBeDefined();
    });
  });

  // Cleanup
  it('cleanup', async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('cleanup failure warning', () => {
    it('surfaces cleanup failure as warning when the failed-state store.update throws', async () => {
      const run = await store.create({
        workflowId: 'test-wf',
        workflowVersion: 1,
        initialState: 'created',
        params: {},
      });

      // Allow the first store.update (pending state) to succeed; throw on the second
      // (the cleanup write that marks the run as failed after dispatch failure).
      let updateCount = 0;
      const originalUpdate = store.update.bind(store);
      vi.spyOn(store, 'update').mockImplementation(async (record) => {
        updateCount++;
        if (updateCount >= 2) throw new Error('store write failed');
        return originalUpdate(record);
      });

      try {
        const envelope = await executeStep(store, guard, definition, {
          runId: run.id,
          command: 'step-one',
          input: {},
          snapshotId: '0',
          dispatcher: failDispatcher,
        });

        expect(envelope.status).toBe('error');
        expect(envelope.errors[0]).toContain('step failed');
        expect(envelope.warnings).toHaveLength(1);
        expect(envelope.warnings[0]).toMatch(/Failed to mark run as failed/);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
