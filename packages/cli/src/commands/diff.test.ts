// Tests for diffRuns business logic.
import { describe, it, expect } from 'vitest';
import { diffRuns } from './diff.js';
import type { RunRecord, EvidenceSnapshot } from '@sensigo/realm';

function makeSnap(
  stepId: string,
  hash: string,
  status: 'success' | 'error' | 'skipped' = 'success',
  durationMs = 100,
): EvidenceSnapshot {
  return {
    step_id: stepId,
    started_at: '2024-01-01T00:00:00.000Z',
    completed_at: '2024-01-01T00:00:01.000Z',
    duration_ms: durationMs,
    input_summary: {},
    output_summary: {},
    status,
    evidence_hash: hash,
  };
}

function makeRun(evidence: EvidenceSnapshot[], workflowId = 'wf1'): RunRecord {
  return {
    id: 'run_' + Math.random().toString(36).slice(2),
    workflow_id: workflowId,
    workflow_version: 1,
    state: 'completed',
    version: 1,
    params: {},
    evidence,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:01.000Z',
    terminal_state: true,
  };
}

describe('diffRuns', () => {
  it('two identical runs produce all same_output: true rows', () => {
    const evidence = [makeSnap('step_a', 'hash1'), makeSnap('step_b', 'hash2')];
    const runA = makeRun(evidence);
    const runB = makeRun(evidence);
    const rows = diffRuns(runA, runB);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.same_output)).toBe(true);
    expect(rows.every((r) => r.same_status)).toBe(true);
  });

  it('steps with different output hashes show same_output: false', () => {
    const runA = makeRun([makeSnap('step_a', 'hashA'), makeSnap('step_b', 'hashB1')]);
    const runB = makeRun([makeSnap('step_a', 'hashA'), makeSnap('step_b', 'hashB2')]);
    const rows = diffRuns(runA, runB);
    expect(rows.find((r) => r.step_id === 'step_a')!.same_output).toBe(true);
    expect(rows.find((r) => r.step_id === 'step_b')!.same_output).toBe(false);
  });

  it('step present in A but missing from B shows status_b: missing', () => {
    const runA = makeRun([makeSnap('step_a', 'hashA'), makeSnap('step_b', 'hashB')]);
    const runB = makeRun([makeSnap('step_a', 'hashA')]);
    const rows = diffRuns(runA, runB);
    const stepBRow = rows.find((r) => r.step_id === 'step_b');
    expect(stepBRow).toBeDefined();
    expect(stepBRow!.status_b).toBe('missing');
    expect(stepBRow!.same_output).toBe(false);
  });

  it('different workflow IDs: diff still returns rows (does not throw)', () => {
    const runA = makeRun([makeSnap('step_a', 'hashX')], 'workflow-1');
    const runB = makeRun([makeSnap('step_a', 'hashX')], 'workflow-2');
    const rows = diffRuns(runA, runB);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.same_output).toBe(true);
  });
});
