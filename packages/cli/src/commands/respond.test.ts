// Tests for respondToGate — CLI respond command logic.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { respondToGate } from './respond.js';
import {
  JsonFileStore,
  JsonWorkflowStore,
  WorkflowError,
  executeStep,
  StateGuard,
} from '@sensigo/realm';
import type { WorkflowDefinition } from '@sensigo/realm';

const gateWorkflow: WorkflowDefinition = {
  id: 'respond-test-wf',
  name: 'Respond Test Workflow',
  version: 1,
  initial_state: 'created',
  steps: {
    'step-one': {
      description: 'Auto step with gate',
      execution: 'auto',
      trust: 'human_confirmed',
      allowed_from_states: ['created'],
      produces_state: 'approved',
    },
  },
};

describe('respondToGate', () => {
  let runDir: string;
  let workflowDir: string;
  let runStore: JsonFileStore;
  let workflowStore: JsonWorkflowStore;

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'realm-respond-run-'));
    workflowDir = await mkdtemp(join(tmpdir(), 'realm-respond-wf-'));
    runStore = new JsonFileStore(runDir);
    workflowStore = new JsonWorkflowStore(workflowDir);
    await workflowStore.register(gateWorkflow);
  });

  it('advances a gate-waiting run to produces_state on valid choice', async () => {
    const run = await runStore.create({
      workflowId: 'respond-test-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    // Open the gate via executeStep.
    const guard = new StateGuard(gateWorkflow);
    const gateEnvelope = await executeStep(runStore, guard, gateWorkflow, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: async () => ({}),
    });
    expect(gateEnvelope.status).toBe('confirm_required');

    const { choice, newState } = await respondToGate(
      run.id,
      { gate: gateEnvelope.gate!.gate_id, choice: 'approve' },
      runStore,
      workflowStore,
    );

    expect(choice).toBe('approve');
    expect(newState).toBe('approved');

    const updated = await runStore.get(run.id);
    expect(updated.state).toBe('approved');
  });

  it('throws WorkflowError when gate_id does not match', async () => {
    const run = await runStore.create({
      workflowId: 'respond-test-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const guard = new StateGuard(gateWorkflow);
    await executeStep(runStore, guard, gateWorkflow, {
      runId: run.id,
      command: 'step-one',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: async () => ({}),
    });

    await expect(
      respondToGate(run.id, { gate: 'wrong-gate-id', choice: 'approve' }, runStore, workflowStore),
    ).rejects.toThrow(WorkflowError);
  });
});
