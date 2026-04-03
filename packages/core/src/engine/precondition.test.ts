// Tests for precondition evaluator — evaluatePrecondition, checkPreconditions, and evaluateAllPreconditions.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePrecondition, checkPreconditions, evaluateAllPreconditions } from './precondition.js';
import { executeStep } from './execution-loop.js';
import { StateGuard } from './state-guard.js';
import { JsonFileStore } from '../store/json-file-store.js';
import type { WorkflowDefinition } from '../types/workflow-definition.js';

describe('evaluatePrecondition', () => {
  it('numeric greater-than passes when condition holds', () => {
    const evidence = { validate: { result: { accepted_count: 5 } } };
    expect(evaluatePrecondition('validate.result.accepted_count > 0', evidence)).toBe(true);
  });

  it('numeric greater-than fails when condition does not hold', () => {
    const evidence = { validate: { result: { accepted_count: 0 } } };
    expect(evaluatePrecondition('validate.result.accepted_count > 0', evidence)).toBe(false);
  });

  it('equality check matches string values', () => {
    const evidence = { step: { result: { status: 'done' } } };
    expect(evaluatePrecondition('step.result.status == done', evidence)).toBe(true);
  });

  it('returns false when the step is not in the evidence map', () => {
    expect(evaluatePrecondition('missing_step.result.count > 0', {})).toBe(false);
  });
});

describe('checkPreconditions', () => {
  it('returns null when all preconditions pass', () => {
    const evidence = { step_a: { count: 3 } };
    const result = checkPreconditions(['step_a.count > 0'], evidence);
    expect(result).toBeNull();
  });

  it('returns the first failing precondition', () => {
    const evidence = { step_a: { count: 0 } };
    // First fails, second would pass.
    const result = checkPreconditions(
      ['step_a.count > 0', 'step_a.count >= 0'],
      evidence,
    );
    expect(result).not.toBeNull();
    expect(result!.expression).toBe('step_a.count > 0');
    expect(result!.passed).toBe(false);
  });
});

describe('executeStep blocks when precondition fails', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-precond-'));
  });

  it('returns status: blocked with suggestion when precondition is unmet', async () => {
    const preconditionDef: WorkflowDefinition = {
      id: 'precond-wf',
      name: 'Precondition Workflow',
      version: 1,
      initial_state: 'created',
      steps: {
        'step-a': {
          description: 'Produces some output',
          execution: 'auto',
          allowed_from_states: ['created'],
          produces_state: 'step_a_done',
        },
        'step-b': {
          description: 'Requires step-a to have run with count > 0',
          execution: 'auto',
          allowed_from_states: ['step_a_done'],
          produces_state: 'completed',
          preconditions: ['step-a.result.count > 0'],
        },
      },
    };

    const store = new JsonFileStore(dir);
    const guard = new StateGuard(preconditionDef);
    const run = await store.create({
      workflowId: 'precond-wf',
      workflowVersion: 1,
      initialState: 'step_a_done', // skip step-a (count never set → precondition fails)
      params: {},
    });

    const envelope = await executeStep(store, guard, preconditionDef, {
      runId: run.id,
      command: 'step-b',
      input: {},
      snapshotId: run.version.toString(),
      dispatcher: async () => ({}),
    });

    expect(envelope.status).toBe('blocked');
    expect(envelope.blocked_reason?.suggestion).toContain('Precondition failed');
    expect(envelope.blocked_reason?.suggestion).toContain("step-a.result.count > 0");
  });
});

describe('evaluateAllPreconditions', () => {
  it('returns all results with passed: true when all preconditions pass', () => {
    const evidence = { step_a: { count: 5 } };
    const results = evaluateAllPreconditions(['step_a.count > 0', 'step_a.count >= 5'], evidence);
    expect(results).toHaveLength(2);
    expect(results[0]!.passed).toBe(true);
    expect(results[1]!.passed).toBe(true);
  });

  it('returns results for both passing and failing expressions in order', () => {
    const evidence = { step_a: { count: 0 } };
    const results = evaluateAllPreconditions(
      ['step_a.count > 0', 'step_a.count >= 0'],
      evidence,
    );
    expect(results).toHaveLength(2);
    expect(results[0]!.expression).toBe('step_a.count > 0');
    expect(results[0]!.passed).toBe(false);
    expect(results[1]!.expression).toBe('step_a.count >= 0');
    expect(results[1]!.passed).toBe(true);
  });
});
