// Tests for human gate mechanics — trust: human_confirmed pauses execution at a gate,
// and submitHumanResponse advances the run after a valid human choice.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeStep, submitHumanResponse } from './execution-loop.js';
import { StateGuard } from './state-guard.js';
import { JsonFileStore } from '../store/json-file-store.js';
import type { WorkflowDefinition } from '../types/workflow-definition.js';
import type { StepDispatcher } from './execution-loop.js';

const autoGateDef: WorkflowDefinition = {
  id: 'auto-gate-wf',
  name: 'Auto Gate Workflow',
  version: 1,
  initial_state: 'created',
  steps: {
    'step-one': {
      description: 'Auto step with human confirmation gate',
      execution: 'auto',
      trust: 'human_confirmed',
      allowed_from_states: ['created'],
      produces_state: 'approved',
    },
  },
};

const agentGateDef: WorkflowDefinition = {
  id: 'agent-gate-wf',
  name: 'Agent Gate Workflow',
  version: 1,
  initial_state: 'created',
  steps: {
    'step-one': {
      description: 'Agent step with human confirmation gate',
      execution: 'agent',
      trust: 'human_confirmed',
      allowed_from_states: ['created'],
      produces_state: 'approved',
    },
  },
};

const echoDispatcher: StepDispatcher = async (_name, input, _run, _signal) => ({ ...input });
const agentDispatcher: StepDispatcher = async () => ({ extracted_text: 'hello' });

describe('human gate', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-gate-'));
  });

  it('trust: human_confirmed step opens gate after dispatcher runs', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(autoGateDef);
    const run = await store.create({
      workflowId: 'auto-gate-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const envelope = await executeStep(store, guard, autoGateDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: echoDispatcher,
    });

    expect(envelope.status).toBe('confirm_required');
    expect(envelope.gate).toBeDefined();
    expect(typeof envelope.gate!.gate_id).toBe('string');
    expect(envelope.gate!.gate_id.length).toBeGreaterThan(0);
    expect(envelope.gate!.choices).toContain('approve');
    expect(envelope.data).toEqual({});

    const updated = await store.get(run.id);
    expect(updated.state).toBe('gate_waiting');
    expect(updated.pending_gate).toBeDefined();
    expect(updated.pending_gate!.gate_id).toBe(envelope.gate!.gate_id);
  });

  it('agent step with trust: human_confirmed exposes agent output as gate preview', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(agentGateDef);
    const run = await store.create({
      workflowId: 'agent-gate-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const envelope = await executeStep(store, guard, agentGateDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: agentDispatcher,
    });

    expect(envelope.status).toBe('confirm_required');
    expect(envelope.gate!.preview).toEqual({ extracted_text: 'hello' });
    expect(envelope.data).toEqual({ extracted_text: 'hello' });
  });

  it('submitHumanResponse with valid choice advances state', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(autoGateDef);
    const run = await store.create({
      workflowId: 'auto-gate-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    // Open the gate.
    const gateEnvelope = await executeStep(store, guard, autoGateDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: echoDispatcher,
    });
    const gateRun = await store.get(run.id);

    const result = await submitHumanResponse(store, autoGateDef, {
      runId: run.id,
      gateId: gateEnvelope.gate!.gate_id,
      choice: 'approve',
      snapshotId: gateRun.version.toString(),
    });

    expect(result.status).toBe('ok');
    expect(result.data['choice']).toBe('approve');

    const final = await store.get(run.id);
    expect(final.state).toBe('approved');
    expect(final.pending_gate).toBeUndefined();
  });

  it('submitHumanResponse with wrong gate_id returns error', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(autoGateDef);
    const run = await store.create({
      workflowId: 'auto-gate-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    await executeStep(store, guard, autoGateDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: echoDispatcher,
    });
    const gateRun = await store.get(run.id);

    const result = await submitHumanResponse(store, autoGateDef, {
      runId: run.id,
      gateId: 'wrong-gate-id',
      choice: 'approve',
      snapshotId: gateRun.version.toString(),
    });

    expect(result.status).toBe('error');
    expect(result.errors[0]).toContain('Gate ID mismatch');
  });

  it('submitHumanResponse with invalid choice returns error', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(autoGateDef);
    const run = await store.create({
      workflowId: 'auto-gate-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const gateEnvelope = await executeStep(store, guard, autoGateDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: echoDispatcher,
    });
    const gateRun = await store.get(run.id);

    const result = await submitHumanResponse(store, autoGateDef, {
      runId: run.id,
      gateId: gateEnvelope.gate!.gate_id,
      choice: 'maybe',
      snapshotId: gateRun.version.toString(),
    });

    expect(result.status).toBe('error');
    expect(result.errors[0]).toContain('not valid');
  });

  it('submitHumanResponse records a gate_response evidence entry', async () => {
    const store = new JsonFileStore(dir);
    const guard = new StateGuard(autoGateDef);
    const run = await store.create({
      workflowId: 'auto-gate-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    // Open the gate.
    const gateEnvelope = await executeStep(store, guard, autoGateDef, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: echoDispatcher,
    });
    const gateRun = await store.get(run.id);

    // Submit a valid response.
    const result = await submitHumanResponse(store, autoGateDef, {
      runId: run.id,
      gateId: gateEnvelope.gate!.gate_id,
      choice: 'approve',
      snapshotId: gateRun.version.toString(),
    });

    expect(result.status).toBe('ok');

    const final = await store.get(run.id);
    // The dispatch run produced one evidence entry; submitHumanResponse must add a second.
    expect(final.evidence).toHaveLength(2);

    const dispatchEntry = final.evidence[0]!;
    expect(dispatchEntry.kind === undefined || dispatchEntry.kind === 'execution').toBe(true);

    const gateEntry = final.evidence[1]!;
    expect(gateEntry.kind).toBe('gate_response');
    expect(gateEntry.step_id).toBe('step-one');
    expect(gateEntry.output_summary['choice']).toBe('approve');
    expect(gateEntry.input_summary['choice']).toBe('approve');
  });
});
