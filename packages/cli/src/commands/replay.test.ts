// Tests for replayRun and parseOverride business logic.
import { describe, it, expect } from 'vitest';
import { replayRun, parseOverride } from './replay.js';
import type { RunRecord, WorkflowDefinition, EvidenceSnapshot } from '@sensigo/realm';

function makeSnapshot(stepId: string, output: Record<string, unknown> = {}): EvidenceSnapshot {
  return {
    step_id: stepId,
    started_at: '2024-01-01T00:00:00.000Z',
    completed_at: '2024-01-01T00:00:01.000Z',
    duration_ms: 100,
    input_summary: {},
    output_summary: output,
    status: 'success',
    evidence_hash: 'abc123',
  };
}

function makeRun(evidence: EvidenceSnapshot[]): RunRecord {
  return {
    id: 'run_test1',
    workflow_id: 'test-workflow',
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

const definition: WorkflowDefinition = {
  id: 'test-workflow',
  name: 'Test Workflow',
  version: 1,
  initial_state: 'created',
  steps: {
    fetch_doc: {
      description: 'Fetch document',
      execution: 'auto',
      allowed_from_states: ['created'],
      produces_state: 'doc_ready',
    },
    extract: {
      description: 'Extract fields',
      execution: 'agent',
      allowed_from_states: ['doc_ready'],
      produces_state: 'extracted',
    },
    validate: {
      description: 'Validate',
      execution: 'auto',
      allowed_from_states: ['extracted'],
      produces_state: 'validated',
    },
    write: {
      description: 'Write results',
      execution: 'auto',
      allowed_from_states: ['validated'],
      produces_state: 'completed',
      preconditions: ['validate.accepted_count > 0'],
    },
  },
};

describe('parseOverride', () => {
  it('parses "validate_candidates.accepted_count=0" to correct ReplayOverride', () => {
    const result = parseOverride('validate_candidates.accepted_count=0');
    expect(result).toEqual({ step: 'validate_candidates', field: 'accepted_count', value: 0 });
  });

  it('parses a string value', () => {
    const result = parseOverride('step.status=done');
    expect(result).toEqual({ step: 'step', field: 'status', value: 'done' });
  });

  it('parses a multi-segment dot-path field — "validate.result.accepted_count=5"', () => {
    const result = parseOverride('validate.result.accepted_count=5');
    expect(result).toEqual({ step: 'validate', field: 'result.accepted_count', value: 5 });
  });

  it('throws on missing equals sign', () => {
    expect(() => parseOverride('validate_candidates.accepted_count')).toThrow("missing '='");
  });

  it('throws on missing dot in field path', () => {
    expect(() => parseOverride('validate=0')).toThrow("missing '.'");
  });
});

describe('replayRun', () => {
  it('override makes a previously-passing precondition fail', () => {
    const evidence = [
      makeSnapshot('validate', { accepted_count: 3 }),
    ];
    const run = makeRun(evidence);
    const results = replayRun(run, definition, [
      { step: 'validate', field: 'accepted_count', value: 0 },
    ]);
    const writeRow = results.find((r) => r.step_id === 'write');
    expect(writeRow).toBeDefined();
    expect(writeRow!.preconditions_original).toBe(true);
    expect(writeRow!.preconditions_replay).toBe(false);
    expect(writeRow!.changed).toBe(true);
  });

  it('override has no effect when no downstream preconditions reference the overridden step', () => {
    const evidence = [makeSnapshot('fetch_doc', { text_length: 1000 })];
    const run = makeRun(evidence);
    const results = replayRun(run, definition, [
      { step: 'fetch_doc', field: 'text_length', value: 0 },
    ]);
    expect(results.every((r) => !r.changed)).toBe(true);
  });

  it('multiple overrides are applied together', () => {
    const evidence = [
      makeSnapshot('validate', { accepted_count: 3, rejected_count: 1 }),
    ];
    const run = makeRun(evidence);
    const results = replayRun(run, definition, [
      { step: 'validate', field: 'accepted_count', value: 0 },
      { step: 'validate', field: 'rejected_count', value: 5 },
    ]);
    const writeRow = results.find((r) => r.step_id === 'write');
    expect(writeRow!.changed).toBe(true);
  });

  it('step with no preconditions always shows unchanged', () => {
    const evidence = [makeSnapshot('fetch_doc', { text_length: 1000 })];
    const run = makeRun(evidence);
    const results = replayRun(run, definition, [
      { step: 'fetch_doc', field: 'text_length', value: 42 },
    ]);
    const fetchRow = results.find((r) => r.step_id === 'fetch_doc');
    expect(fetchRow).toBeDefined();
    expect(fetchRow!.preconditions_original).toBe(true);
    expect(fetchRow!.preconditions_replay).toBe(true);
    expect(fetchRow!.changed).toBe(false);
  });

  it('dot-path override correctly changes a nested-field precondition outcome', () => {
    const nestedDef: WorkflowDefinition = {
      ...definition,
      steps: {
        ...definition.steps,
        write: {
          description: 'Write results',
          execution: 'auto',
          allowed_from_states: ['validated'],
          produces_state: 'completed',
          preconditions: ['validate.result.accepted_count > 0'],
        },
      },
    };
    const evidence = [makeSnapshot('validate', { result: { accepted_count: 3 } })];
    const run = makeRun(evidence);
    const results = replayRun(run, nestedDef, [
      { step: 'validate', field: 'result.accepted_count', value: 0 },
    ]);
    const writeRow = results.find((r) => r.step_id === 'write')!;
    expect(writeRow.preconditions_original).toBe(true);
    expect(writeRow.preconditions_replay).toBe(false);
    expect(writeRow.changed).toBe(true);
  });

  it('dot-path override does not mutate the original evidence object', () => {
    const nestedDef: WorkflowDefinition = {
      ...definition,
      steps: {
        ...definition.steps,
        write: {
          description: 'Write results',
          execution: 'auto',
          allowed_from_states: ['validated'],
          produces_state: 'completed',
          preconditions: ['validate.result.accepted_count > 0'],
        },
      },
    };
    const originalOutput = { result: { accepted_count: 3 } };
    const evidence = [makeSnapshot('validate', originalOutput)];
    const run = makeRun(evidence);

    replayRun(run, nestedDef, [
      { step: 'validate', field: 'result.accepted_count', value: 0 },
    ]);

    // Original evidence must not have been mutated.
    expect(originalOutput.result.accepted_count).toBe(3);
  });
});
