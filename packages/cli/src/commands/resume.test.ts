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
  steps: {
    'step-one': {
      description: 'First step',
      execution: 'auto',
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

  it('removes the step from failed_steps, re-enabling it for execution', async () => {
    const run = await runStore.create({
      workflowId: 'resume-test-wf',
      workflowVersion: 1,
      params: {},
    });
    // Simulate a failed run
    await runStore.update({
      ...run,
      run_phase: 'failed',
      failed_steps: ['step-one'],
      terminal_state: true,
      terminal_reason: 'Something went wrong',
    });

    await resumeRun(run.id, 'step-one', runStore, workflowStore);

    const updated = await runStore.get(run.id);
    expect(updated.failed_steps).not.toContain('step-one');
  });

  it('throws when the run is in a non-resumable state (completed)', async () => {
    const run = await runStore.create({
      workflowId: 'resume-test-wf',
      workflowVersion: 1,
      params: {},
    });
    await runStore.update({
      ...run,
      run_phase: 'completed',
      terminal_state: true,
      terminal_reason: 'Workflow completed.',
    });

    await expect(resumeRun(run.id, 'step-one', runStore, workflowStore)).rejects.toThrow(
      WorkflowError,
    );

    await expect(resumeRun(run.id, 'step-one', runStore, workflowStore)).rejects.toThrow(
      'is not resumable',
    );
  });

  it('throws when the step name does not exist in the workflow', async () => {
    const run = await runStore.create({
      workflowId: 'resume-test-wf',
      workflowVersion: 1,
      params: {},
    });
    await runStore.update({
      ...run,
      run_phase: 'failed',
      failed_steps: ['step-one'],
      terminal_state: true,
      terminal_reason: 'Something went wrong',
    });

    await expect(
      resumeRun(run.id, 'nonexistent-step', runStore, workflowStore),
    ).rejects.toThrow(WorkflowError);

    await expect(
      resumeRun(run.id, 'nonexistent-step', runStore, workflowStore),
    ).rejects.toThrow('not found');
  });
});
