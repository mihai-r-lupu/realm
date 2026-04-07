// Integration tests for the create_workflow tool business logic.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileStore, JsonWorkflowStore } from '@sensigo/realm';
import { handleCreateWorkflow, type CreateWorkflowArgs } from './create-workflow.js';

describe('handleCreateWorkflow', () => {
  let runDir: string;
  let workflowDir: string;
  let stores: { runStore: JsonFileStore; workflowStore: JsonWorkflowStore };

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'realm-cw-run-'));
    workflowDir = await mkdtemp(join(tmpdir(), 'realm-cw-wf-'));
    stores = {
      runStore: new JsonFileStore(runDir),
      workflowStore: new JsonWorkflowStore(workflowDir),
    };
  });

  it('happy path — single step: returns ok and next_action pointing at the step', async () => {
    const result = await handleCreateWorkflow(
      { steps: [{ id: 'research', description: 'Research the topic' }] },
      stores,
    );
    expect(result.status).toBe('ok');
    expect(result.run_id).not.toBe('');
    expect(result.next_action?.instruction?.call_with.command).toBe('research');
  });

  it('happy path — multi-step: ok, first step in next_action, 3 steps in store', async () => {
    const args: CreateWorkflowArgs = {
      steps: [
        { id: 'plan', description: 'Plan the work' },
        { id: 'execute', description: 'Execute the plan' },
        { id: 'report', description: 'Write the report' },
      ],
    };
    const result = await handleCreateWorkflow(args, stores);
    expect(result.status).toBe('ok');
    expect(result.next_action?.instruction?.call_with.command).toBe('plan');

    const def = await stores.workflowStore.get(result.data['workflow_id'] as string);
    expect(Object.keys(def.steps)).toHaveLength(3);
  });

  it('happy path — metadata.name produces a readable workflow_id', async () => {
    const result = await handleCreateWorkflow(
      {
        steps: [{ id: 'step-a', description: 'Do something' }],
        metadata: { name: 'Company Research' },
      },
      stores,
    );
    expect(result.status).toBe('ok');
    expect(result.data['workflow_id']).toMatch(/^company-research-/);
  });

  it('happy path — no metadata produces a dynamic- workflow_id', async () => {
    const result = await handleCreateWorkflow(
      { steps: [{ id: 'step-a', description: 'Do something' }] },
      stores,
    );
    expect(result.status).toBe('ok');
    expect(result.data['workflow_id']).toMatch(/^dynamic-/);
  });

  it('happy path — input_schema is forwarded to the step and next_action', async () => {
    const schema = { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } };
    const result = await handleCreateWorkflow(
      {
        steps: [{ id: 'step-schema', description: 'Schemed step', input_schema: schema }],
      },
      stores,
    );
    expect(result.status).toBe('ok');
    const def = await stores.workflowStore.get(result.data['workflow_id'] as string);
    expect(def.steps['step-schema']?.input_schema).toEqual(schema);
    expect(result.next_action?.input_schema).toEqual(schema);
  });

  it('validation — empty steps array returns error with provide_input', async () => {
    const result = await handleCreateWorkflow(
      { steps: [] } as unknown as CreateWorkflowArgs,
      stores,
    );
    expect(result.status).toBe('error');
    expect(result.agent_action).toBe('provide_input');
    expect(result.errors.some((e) => e.includes('at least one step'))).toBe(true);
  });

  it('validation — duplicate step IDs returns error mentioning Duplicate', async () => {
    const result = await handleCreateWorkflow(
      {
        steps: [
          { id: 'step-a', description: 'First' },
          { id: 'step-a', description: 'Second — duplicate' },
        ],
      },
      stores,
    );
    expect(result.status).toBe('error');
    expect(result.agent_action).toBe('provide_input');
    expect(result.errors.some((e) => e.includes('Duplicate step id'))).toBe(true);
  });

  it('validation — step ID with spaces returns error mentioning invalid', async () => {
    const result = await handleCreateWorkflow(
      { steps: [{ id: 'bad id', description: 'Bad step' }] },
      stores,
    );
    expect(result.status).toBe('error');
    expect(result.errors.some((e) => e.includes('invalid'))).toBe(true);
  });

  it('validation — depends_on with multiple predecessors returns error', async () => {
    const result = await handleCreateWorkflow(
      {
        steps: [
          { id: 'a', description: 'Step A' },
          { id: 'b', description: 'Step B' },
          { id: 'c', description: 'Step C', depends_on: ['a', 'b'] },
        ],
      },
      stores,
    );
    expect(result.status).toBe('error');
    expect(result.errors.some((e) => e.includes('at most one predecessor'))).toBe(true);
  });

  it('validation — depends_on unknown reference returns error', async () => {
    const result = await handleCreateWorkflow(
      {
        steps: [
          { id: 'step-a', description: 'Step A', depends_on: ['unknown-step'] },
        ],
      },
      stores,
    );
    expect(result.status).toBe('error');
    expect(result.errors.some((e) => e.includes('unknown step'))).toBe(true);
  });

  it('validation — agent_profile rejected with provide_input', async () => {
    const result = await handleCreateWorkflow(
      {
        steps: [
          { id: 'step-a', description: 'A step', agent_profile: 'some-profile' } as unknown as import('./create-workflow.js').CreateWorkflowStep,
        ],
      },
      stores,
    );
    expect(result.status).toBe('error');
    expect(result.agent_action).toBe('provide_input');
    expect(result.errors.some((e) => e.includes('agent_profile is not supported on dynamically-created workflows'))).toBe(true);
  });

  it('validation — multiple errors collected together', async () => {
    const result = await handleCreateWorkflow(
      {
        steps: [
          { id: 'bad id', description: '' },
        ],
      },
      stores,
    );
    expect(result.status).toBe('error');
    // Both "invalid id" and "description must be non-empty" should appear
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
