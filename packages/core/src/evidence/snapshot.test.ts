import { describe, it, expect } from 'vitest';
import { captureEvidence } from './snapshot.js';
import type { StepDiagnostics } from '../types/run-record.js';

describe('captureEvidence', () => {
  const base = {
    stepId: 'test-step',
    startedAt: new Date('2024-01-01T00:00:00.000Z'),
    completedAt: new Date('2024-01-01T00:00:01.000Z'),
    input: { key: 'value' },
    output: { result: 42 },
  };

  it('returns correct step_id, started_at, completed_at, duration_ms', () => {
    const ev = captureEvidence(base);
    expect(ev.step_id).toBe('test-step');
    expect(ev.started_at).toBe('2024-01-01T00:00:00.000Z');
    expect(ev.completed_at).toBe('2024-01-01T00:00:01.000Z');
    expect(ev.duration_ms).toBe(1000);
  });

  it('status is success when no error is passed', () => {
    const ev = captureEvidence(base);
    expect(ev.status).toBe('success');
    expect(ev.error).toBeUndefined();
  });

  it('status is error and error field is set when error param is provided', () => {
    const ev = captureEvidence({ ...base, error: 'something went wrong' });
    expect(ev.status).toBe('error');
    expect(ev.error).toBe('something went wrong');
  });

  it('evidence_hash is deterministic: same output produces same hash', () => {
    const ev1 = captureEvidence(base);
    const ev2 = captureEvidence(base);
    expect(ev1.evidence_hash).toBe(ev2.evidence_hash);
  });

  it('evidence_hash changes when output changes', () => {
    const ev1 = captureEvidence(base);
    const ev2 = captureEvidence({ ...base, output: { result: 99 } });
    expect(ev1.evidence_hash).not.toBe(ev2.evidence_hash);
  });

  it('includes diagnostics when provided in params', () => {
    const diag: StepDiagnostics = {
      input_token_estimate: 10,
      precondition_trace: [{ expression: 'step.count > 0', passed: true, resolved_value: 5 }],
    };
    const ev = captureEvidence({ ...base, diagnostics: diag });
    expect(ev.diagnostics).toEqual(diag);
  });
});
