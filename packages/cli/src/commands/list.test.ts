// Tests for listRuns business logic.
import { describe, it, expect } from 'vitest';
import { listRuns } from './list.js';
import type { RunStore, RunRecord } from '@sensigo/realm';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-abc123',
    workflow_id: 'test-workflow',
    workflow_version: 1,
    state: 'completed',
    version: 2,
    params: {},
    evidence: [],
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:01:00.000Z',
    terminal_state: true,
    ...overrides,
  };
}

function makeStore(runs: RunRecord[]): RunStore {
  return {
    get: async () => runs[0]!,
    create: async () => runs[0]!,
    update: async () => runs[0]!,
    list: async (workflowId?: string) =>
      workflowId !== undefined ? runs.filter((r) => r.workflow_id === workflowId) : runs,
  };
}

describe('listRuns', () => {
  it('returns a no-runs message when the store is empty', async () => {
    const result = await listRuns(undefined, makeStore([]));
    expect(result).toContain('No runs found');
  });

  it('includes workflow-specific message when filter returns nothing', async () => {
    const result = await listRuns('missing-workflow', makeStore([]));
    expect(result).toContain("No runs found for workflow 'missing-workflow'");
  });

  it('includes run id, workflow id, version, and state', async () => {
    const run = makeRun();
    const result = await listRuns(undefined, makeStore([run]));
    expect(result).toContain('run-abc123');
    expect(result).toContain('test-workflow');
    expect(result).toContain('v1');
    expect(result).toContain('completed');
  });

  it('includes the step count (excluding gate_response entries)', async () => {
    const run = makeRun({
      evidence: [
        { step_id: 'step_one', kind: 'execution', started_at: '', completed_at: '', duration_ms: 1, input_summary: {}, output_summary: {}, status: 'success', evidence_hash: 'x' },
        { step_id: 'step_one', kind: 'gate_response', started_at: '', completed_at: '', duration_ms: 1, input_summary: {}, output_summary: {}, status: 'success', evidence_hash: 'y' },
      ],
    });
    const result = await listRuns(undefined, makeStore([run]));
    expect(result).toContain('1 step(s)');
  });

  it('sorts runs by updated_at descending', async () => {
    const older = makeRun({ id: 'run-old', updated_at: '2024-01-01T00:00:00.000Z', workflow_id: 'wf', workflow_version: 1 });
    const newer = makeRun({ id: 'run-new', updated_at: '2024-06-01T00:00:00.000Z', workflow_id: 'wf', workflow_version: 1 });
    const result = await listRuns(undefined, makeStore([older, newer]));
    expect(result.indexOf('run-new')).toBeLessThan(result.indexOf('run-old'));
  });

  it('filters by workflowId when provided', async () => {
    const a = makeRun({ id: 'run-a', workflow_id: 'wf-a' });
    const b = makeRun({ id: 'run-b', workflow_id: 'wf-b' });
    const result = await listRuns('wf-a', makeStore([a, b]));
    expect(result).toContain('run-a');
    expect(result).not.toContain('run-b');
  });
});
