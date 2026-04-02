// Tests for the resumeRun function — CLI resume command logic.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resumeRun } from './resume.js';
import { JsonFileStore, JsonWorkflowStore, WorkflowError } from '@sensigo/realm';
import type { WorkflowDefinition } from '@sensigo/realm';

const testWorkflow: WorkflowDefinition = {
  id: 'resume-test-wf',
  name: 'Resume Test Workflow',
  version: 1,
  initial_state: 'created',
  steps: {
    'step-one': {
      description: 'First step',
      execution: 'auto',
      allowed_from_states: ['created'],
      produces_state: 'completed',
    },
  },
};

describe('resumeRun', () => {
  let runDir: string;
  let workflowDir: string;
  let runStore: JsonFileStore;
  let workflowStore: JsonWorkflowStore;

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'realm-resume-run-'));
    workflowDir = await mkdtemp(join(tmpdir(), 'realm-resume-wf-'));
    runStore = new JsonFileStore(runDir);
    workflowStore = new JsonWorkflowStore(workflowDir);
    await workflowStore.register(testWorkflow);
  });

  it('resumes a failed run — state is reset to the step allowed_from_state', async () => {
    const run = await runStore.create({
      workflowId: 'resume-test-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });
    // Simulate a failed run
    await runStore.update({
      ...run,
      state: 'failed',
      terminal_state: true,
      terminal_reason: 'Something went wrong',
    });

    const { resetState } = await resumeRun(
      run.id,
      { from: 'step-one' },
      runStore,
      workflowStore,
    );

    expect(resetState).toBe('created');
    const updated = await runStore.get(run.id);
    expect(updated.state).toBe('created');
    expect(updated.terminal_state).toBe(false);
    expect(updated.terminal_reason).toBeUndefined();
  });

  it('throws when the run is in a non-resumable state (completed)', async () => {
    const run = await runStore.create({
      workflowId: 'resume-test-wf',
      workflowVersion: 1,
      initialState: 'completed',
      params: {},
    });
    await runStore.update({ ...run, state: 'completed', terminal_state: true });

    await expect(
      resumeRun(run.id, { from: 'step-one' }, runStore, workflowStore),
    ).rejects.toThrow(WorkflowError);

    await expect(
      resumeRun(run.id, { from: 'step-one' }, runStore, workflowStore),
    ).rejects.toThrow("is not resumable");
  });

  it('throws when the step name does not exist in the workflow', async () => {
    const run = await runStore.create({
      workflowId: 'resume-test-wf',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });
    await runStore.update({ ...run, state: 'failed', terminal_state: true });

    await expect(
      resumeRun(run.id, { from: 'nonexistent-step' }, runStore, workflowStore),
    ).rejects.toThrow(WorkflowError);

    await expect(
      resumeRun(run.id, { from: 'nonexistent-step' }, runStore, workflowStore),
    ).rejects.toThrow("not found");
  });
});
