// Tests for inspectRun business logic.
import { describe, it, expect } from 'vitest';
import { inspectRun } from './inspect.js';
import type {
  RunStore,
  RunRecord,
  WorkflowRegistrar,
  WorkflowDefinition,
  EvidenceSnapshot,
  StepDiagnostics,
} from '@sensigo/realm';

function makeSnapshot(stepId: string, overrides: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot {
  return {
    step_id: stepId,
    started_at: '2024-01-01T00:00:00.000Z',
    completed_at: '2024-01-01T00:00:01.000Z',
    duration_ms: 1000,
    input_summary: {},
    output_summary: {},
    status: 'success',
    evidence_hash: 'abc123def456789012345678901234567890abcd',
    ...overrides,
  };
}

function makeRun(evidence: EvidenceSnapshot[] = [], overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run_test1',
    workflow_id: 'test-workflow',
    workflow_version: 1,
    run_phase: 'completed',
    completed_steps: [],
    in_progress_steps: [],
    failed_steps: [],
    skipped_steps: [],
    version: 1,
    params: {},
    evidence,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:01.000Z',
    terminal_state: true,
    ...overrides,
  };
}

function makeRunStore(run: RunRecord): RunStore {
  return {
    get: async () => run,
    create: async () => run,
    update: async () => run,
    list: async () => [run],
  };
}

function makeWorkflowStore(def?: WorkflowDefinition): WorkflowRegistrar {
  if (def !== undefined) {
    return {
      register: async () => {},
      get: async () => def,
      list: async () => [def],
    };
  }
  return {
    register: async () => {},
    get: async () => {
      throw new Error('Workflow not found');
    },
    list: async () => [],
  };
}

const basicDef: WorkflowDefinition = {
  id: 'test-workflow',
  name: 'Test Workflow',
  version: 1,
  steps: {
    step_one: {
      description: 'First step',
      execution: 'agent',
    },
  },
};

describe('inspectRun', () => {
  it('shows run ID, workflow ID, state, and evidence steps for a completed run', async () => {
    const run = makeRun([makeSnapshot('step_one')]);
    const result = await inspectRun('run_test1', makeRunStore(run), makeWorkflowStore(basicDef));
    expect(result).toContain('Run: run_test1');
    expect(result).toContain('test-workflow');
    expect(result).toContain('completed');
    expect(result).toContain('step_one');
    expect(result).toContain('Evidence (1 steps)');
  });

  it('shows retry attempts grouped when a step has multiple evidence snapshots with attempt', async () => {
    const snap1 = makeSnapshot('step_one', { attempt: 1, status: 'error' });
    const snap2 = makeSnapshot('step_one', { attempt: 2, status: 'success' });
    const run = makeRun([snap1, snap2]);
    const result = await inspectRun('run_test1', makeRunStore(run), makeWorkflowStore(basicDef));
    expect(result).toContain('(attempt 1/2)');
    expect(result).toContain('(attempt 2/2)');
  });

  it('shows diagnostics line when diagnostics is present on a snapshot', async () => {
    const diag: StepDiagnostics = {
      input_token_estimate: 32,
      precondition_trace: [],
    };
    const snap = makeSnapshot('step_one', { diagnostics: diag });
    const run = makeRun([snap]);
    const result = await inspectRun('run_test1', makeRunStore(run), makeWorkflowStore(basicDef));
    expect(result).toContain('Diagnostics:');
    expect(result).toContain('~32 tokens');
    expect(result).toContain('no preconditions');
  });

  it('handles missing workflow definition gracefully (warning line, no crash)', async () => {
    const run = makeRun([makeSnapshot('step_one')]);
    const workflowStore = makeWorkflowStore(); // no def — will throw
    const result = await inspectRun('run_test1', makeRunStore(run), workflowStore);
    expect(result).toContain('workflow definition not found');
    expect(result).toContain('step_one');
    expect(result).toContain('Evidence (1 steps)');
  });
});
