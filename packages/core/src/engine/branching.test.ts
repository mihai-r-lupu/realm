// Tests for conditional branching — on_error transitions and gate-response transitions.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeChain, submitHumanResponse } from './execution-loop.js';
import { StateGuard } from './state-guard.js';
import { JsonFileStore } from '../store/json-file-store.js';
import { WorkflowError } from '../types/workflow-error.js';
import { ExtensionRegistry } from '../extensions/registry.js';
import type { WorkflowDefinition } from '../types/workflow-definition.js';
import type { StepDispatcher } from './execution-loop.js';
import type { StepHandler, StepHandlerInputs, StepContext, StepHandlerResult } from '../extensions/step-handler.js';

/** A handler that always throws a WorkflowError. */
class FailingHandler implements StepHandler {
  readonly id = 'always_fail';
  async execute(_inputs: StepHandlerInputs, _ctx: StepContext): Promise<StepHandlerResult> {
    throw new WorkflowError('Handler deliberately failed', {
      code: 'ENGINE_HANDLER_FAILED',
      category: 'ENGINE',
      agentAction: 'provide_input',
      retryable: false,
    });
  }
}

/** A handler that returns { confidence: value } for on_success routing tests. */
class ConfidenceHandler implements StepHandler {
  constructor(private readonly value: string) {}
  readonly id = 'confidence_handler';
  async execute(_inputs: StepHandlerInputs, _ctx: StepContext): Promise<StepHandlerResult> {
    return { data: { confidence: this.value } };
  }
}

/** Workflow: auto failing step → on_error → agent recovery step */
function makeOnErrorToAgentWorkflow(): WorkflowDefinition {
  return {
    id: 'on-error-agent-wf',
    name: 'On Error to Agent',
    version: 1,
    initial_state: 'started',
    steps: {
      validate: {
        description: 'Auto step with handler that fails',
        execution: 'auto',
        handler: 'always_fail',
        allowed_from_states: ['started'],
        produces_state: 'validated',
        transitions: {
          on_error: { step: 'recover', produces_state: 'recovery_needed' },
        },
      },
      recover: {
        description: 'Agent recovery step',
        execution: 'agent',
        allowed_from_states: ['recovery_needed'],
        produces_state: 'completed',
      },
    },
  };
}

/** Workflow: auto failing step → on_error → auto recovery step → completed */
function makeOnErrorToAutoWorkflow(): WorkflowDefinition {
  return {
    id: 'on-error-auto-wf',
    name: 'On Error to Auto',
    version: 1,
    initial_state: 'started',
    steps: {
      validate: {
        description: 'Auto step with handler that fails',
        execution: 'auto',
        handler: 'always_fail',
        allowed_from_states: ['started'],
        produces_state: 'validated',
        transitions: {
          on_error: { step: 'auto_recover', produces_state: 'recovery_needed' },
        },
      },
      auto_recover: {
        description: 'Auto recovery step (no handler — uses dispatcher)',
        execution: 'auto',
        allowed_from_states: ['recovery_needed'],
        produces_state: 'completed',
      },
    },
  };
}

/** Workflow: auto failing step without transition */
function makeNoTransitionWorkflow(): WorkflowDefinition {
  return {
    id: 'no-transition-wf',
    name: 'No Transition',
    version: 1,
    initial_state: 'started',
    steps: {
      validate: {
        description: 'Auto step with handler that fails, no on_error',
        execution: 'auto',
        handler: 'always_fail',
        allowed_from_states: ['started'],
        produces_state: 'validated',
      },
    },
  };
}

/** Workflow: auto gate step → on_reject → agent step */
function makeGateTransitionWorkflow(): WorkflowDefinition {
  return {
    id: 'gate-transition-wf',
    name: 'Gate Transition',
    version: 1,
    initial_state: 'started',
    steps: {
      confirm: {
        description: 'Human gate with on_reject transition',
        execution: 'auto',
        trust: 'human_confirmed',
        allowed_from_states: ['started'],
        produces_state: 'approved',
        gate: { choices: ['approve', 'reject'] },
        transitions: {
          on_reject: { step: 'revise', produces_state: 'revision_needed' },
        },
      },
      revise: {
        description: 'Agent revision step',
        execution: 'agent',
        allowed_from_states: ['revision_needed'],
        produces_state: 'started',
      },
    },
  };
}

const passthroughDispatcher: StepDispatcher = async () => ({});

describe('on_error branching', () => {
  let dir: string;
  let store: JsonFileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-branch-test-'));
    store = new JsonFileStore(dir);
  });

  it('step fails with on_error → agent recovery: status ok, next_action at recovery step, warning in envelope', async () => {
    const definition = makeOnErrorToAgentWorkflow();
    const guard = new StateGuard(definition);
    const registry = new ExtensionRegistry();
    registry.register('handler', 'always_fail', new FailingHandler());

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: 1,
      initialState: 'started',
      params: {},
    });

    const result = await executeChain(store, guard, definition, {
      runId: run.id,
      command: 'validate',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: passthroughDispatcher,
      registry,
    });

    expect(result.status).toBe('ok');
    expect(result.next_action).not.toBeNull();
    expect(result.next_action?.instruction?.tool).toBe('execute_step');
    expect((result.next_action?.instruction?.params as Record<string, unknown>)?.['command']).toBe('recover');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('validate');
    expect(result.warnings[0]).toContain('on_error');

    const updatedRun = await store.get(run.id);
    expect(updatedRun.state).toBe('recovery_needed');
    expect(updatedRun.terminal_state).toBe(false);
  });

  it('step fails without on_error transition → original error returned', async () => {
    const definition = makeNoTransitionWorkflow();
    const guard = new StateGuard(definition);
    const registry = new ExtensionRegistry();
    registry.register('handler', 'always_fail', new FailingHandler());

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: 1,
      initialState: 'started',
      params: {},
    });

    const result = await executeChain(store, guard, definition, {
      runId: run.id,
      command: 'validate',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: passthroughDispatcher,
      registry,
    });

    expect(result.status).toBe('error');
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('step fails with on_error → auto recovery: chain continues through auto step', async () => {
    const definition = makeOnErrorToAutoWorkflow();
    const guard = new StateGuard(definition);
    const registry = new ExtensionRegistry();
    registry.register('handler', 'always_fail', new FailingHandler());

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: 1,
      initialState: 'started',
      params: {},
    });

    const result = await executeChain(store, guard, definition, {
      runId: run.id,
      command: 'validate',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: passthroughDispatcher,
      registry,
    });

    // The auto recovery step ran and completed — terminal state
    expect(result.status).toBe('ok');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('on_error');

    const updatedRun = await store.get(run.id);
    expect(updatedRun.state).toBe('completed');
  });

  it('chained_auto_steps entries for branch hops include branched_via', async () => {
    const definition = makeOnErrorToAgentWorkflow();
    const guard = new StateGuard(definition);
    const registry = new ExtensionRegistry();
    registry.register('handler', 'always_fail', new FailingHandler());

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: 1,
      initialState: 'started',
      params: {},
    });

    const result = await executeChain(store, guard, definition, {
      runId: run.id,
      command: 'validate',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: passthroughDispatcher,
      registry,
    });

    expect(result.chained_auto_steps).toBeDefined();
    expect(result.chained_auto_steps).toHaveLength(1);
    expect(result.chained_auto_steps![0]!.step).toBe('validate');
    expect(result.chained_auto_steps![0]!.produced_state).toBe('recovery_needed');
    expect(result.chained_auto_steps![0]!.branched_via).toBe('on_error');
  });

  it('cleanup', async () => {
    await rm(dir, { recursive: true, force: true });
  });
});

describe('on_success branching', () => {
  let dir: string;
  let store: JsonFileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-on-success-test-'));
    store = new JsonFileStore(dir);
  });

  function makeOnSuccessWorkflow(): WorkflowDefinition {
    return {
      id: 'on-success-wf',
      name: 'On Success Workflow',
      version: 1,
      initial_state: 'started',
      steps: {
        check_identity: {
          description: 'Check identity confidence',
          execution: 'auto',
          handler: 'confidence_handler',
          allowed_from_states: ['started'],
          produces_state: 'identity_checked',
          transitions: {
            on_success: {
              field: 'confidence',
              routes: {
                high: { step: 'extract', produces_state: 'identity_confirmed' },
                low: { step: 'manual_confirm', produces_state: 'identity_uncertain' },
              },
              default: { step: 'manual_confirm', produces_state: 'identity_uncertain' },
            },
          },
        },
        extract: {
          description: 'Extract description (auto)',
          execution: 'auto',
          allowed_from_states: ['identity_confirmed'],
          produces_state: 'extracted',
        },
        manual_confirm: {
          description: 'Manual confirmation step',
          execution: 'agent',
          allowed_from_states: ['identity_uncertain'],
          produces_state: 'confirmed',
        },
      },
    };
  }

  it('on_success high confidence routes to extract step', async () => {
    const definition = makeOnSuccessWorkflow();
    const guard = new StateGuard(definition);
    const registry = new ExtensionRegistry();
    registry.register('handler', 'confidence_handler', new ConfidenceHandler('high'));

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: 1,
      initialState: 'started',
      params: {},
    });

    const result = await executeChain(store, guard, definition, {
      runId: run.id,
      command: 'check_identity',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: passthroughDispatcher,
      registry,
    });

    expect(result.status).toBe('ok');
    // extract is auto — chain runs through it to terminal state
    const updatedRun = await store.get(run.id);
    expect(updatedRun.state).toBe('extracted');
    expect(result.chained_auto_steps).toBeDefined();
    expect(result.chained_auto_steps![0]!.step).toBe('check_identity');
    expect(result.chained_auto_steps![0]!.produced_state).toBe('identity_confirmed');
    expect(result.chained_auto_steps![0]!.branched_via).toBe('on_success');
  });

  it('on_success low confidence routes to manual_confirm (agent) step', async () => {
    const definition = makeOnSuccessWorkflow();
    const guard = new StateGuard(definition);
    const registry = new ExtensionRegistry();
    registry.register('handler', 'confidence_handler', new ConfidenceHandler('low'));

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: 1,
      initialState: 'started',
      params: {},
    });

    const result = await executeChain(store, guard, definition, {
      runId: run.id,
      command: 'check_identity',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: passthroughDispatcher,
      registry,
    });

    expect(result.status).toBe('ok');
    const updatedRun = await store.get(run.id);
    expect(updatedRun.state).toBe('identity_uncertain');
    expect(result.next_action?.instruction?.tool).toBe('execute_step');
    expect((result.next_action?.instruction?.params as Record<string, unknown>)?.['command']).toBe('manual_confirm');
    expect(result.chained_auto_steps).toBeDefined();
    expect(result.chained_auto_steps![0]!.produced_state).toBe('identity_uncertain');
    expect(result.chained_auto_steps![0]!.branched_via).toBe('on_success');
  });

  it('on_success unknown value uses default route', async () => {
    const definition = makeOnSuccessWorkflow();
    const guard = new StateGuard(definition);
    const registry = new ExtensionRegistry();
    registry.register('handler', 'confidence_handler', new ConfidenceHandler('unknown_value'));

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: 1,
      initialState: 'started',
      params: {},
    });

    const result = await executeChain(store, guard, definition, {
      runId: run.id,
      command: 'check_identity',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: passthroughDispatcher,
      registry,
    });

    expect(result.status).toBe('ok');
    const updatedRun = await store.get(run.id);
    expect(updatedRun.state).toBe('identity_uncertain');
    expect(result.chained_auto_steps![0]!.branched_via).toBe('on_success');
    expect(result.chained_auto_steps![0]!.produced_state).toBe('identity_uncertain');
  });

  it('step without on_success uses top-level produces_state (backward compat)', async () => {
    const definition: WorkflowDefinition = {
      id: 'no-on-success-wf',
      name: 'No On Success',
      version: 1,
      initial_state: 'started',
      steps: {
        check_identity: {
          description: 'Check (no on_success)',
          execution: 'auto',
          handler: 'confidence_handler',
          allowed_from_states: ['started'],
          produces_state: 'identity_checked',
        },
      },
    };
    const guard = new StateGuard(definition);
    const registry = new ExtensionRegistry();
    registry.register('handler', 'confidence_handler', new ConfidenceHandler('high'));

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: 1,
      initialState: 'started',
      params: {},
    });

    const result = await executeChain(store, guard, definition, {
      runId: run.id,
      command: 'check_identity',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: passthroughDispatcher,
      registry,
    });

    expect(result.status).toBe('ok');
    const updatedRun = await store.get(run.id);
    expect(updatedRun.state).toBe('identity_checked');
    if (result.chained_auto_steps !== undefined) {
      expect(result.chained_auto_steps.every((s) => s.branched_via === undefined)).toBe(true);
    }
  });

  it('cleanup', async () => {
    await rm(dir, { recursive: true, force: true });
  });
});

describe('gate-response transition', () => {
  let dir: string;
  let store: JsonFileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-gate-branch-test-'));
    store = new JsonFileStore(dir);
  });

  it('on_reject transition: submit reject routes to target step, next_action points there', async () => {
    const definition = makeGateTransitionWorkflow();
    const guard = new StateGuard(definition);

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: 1,
      initialState: 'started',
      params: {},
    });

    // Open the gate
    const gateResult = await executeChain(store, guard, definition, {
      runId: run.id,
      command: 'confirm',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: passthroughDispatcher,
    });

    expect(gateResult.status).toBe('confirm_required');
    const gateId = gateResult.gate!.gate_id;
    const gateRun = await store.get(run.id);

    // Submit reject choice
    const rejectResult = await submitHumanResponse(store, definition, {
      runId: run.id,
      gateId,
      choice: 'reject',
      snapshotId: gateRun.version.toString(),
    });

    expect(rejectResult.status).toBe('ok');
    expect(rejectResult.next_action).not.toBeNull();
    expect(rejectResult.next_action?.instruction?.tool).toBe('execute_step');
    expect((rejectResult.next_action?.instruction?.params as Record<string, unknown>)?.['command']).toBe('revise');
    expect(rejectResult.chained_auto_steps).toBeDefined();
    expect(rejectResult.chained_auto_steps![0]!.branched_via).toBe('on_reject');
    expect(rejectResult.chained_auto_steps![0]!.produced_state).toBe('revision_needed');

    const updatedRun = await store.get(run.id);
    expect(updatedRun.state).toBe('revision_needed');
  });

  it('approve with no transition: normal flow to produces_state', async () => {
    const definition = makeGateTransitionWorkflow();
    const guard = new StateGuard(definition);

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: 1,
      initialState: 'started',
      params: {},
    });

    const gateResult = await executeChain(store, guard, definition, {
      runId: run.id,
      command: 'confirm',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: passthroughDispatcher,
    });

    expect(gateResult.status).toBe('confirm_required');
    const gateId = gateResult.gate!.gate_id;
    const gateRun = await store.get(run.id);

    const approveResult = await submitHumanResponse(store, definition, {
      runId: run.id,
      gateId,
      choice: 'approve',
      snapshotId: gateRun.version.toString(),
    });

    expect(approveResult.status).toBe('ok');
    expect(approveResult.chained_auto_steps).toBeUndefined();
    const finalRun = await store.get(run.id);
    expect(finalRun.state).toBe('approved');
  });

  it('cleanup', async () => {
    await rm(dir, { recursive: true, force: true });
  });
});
