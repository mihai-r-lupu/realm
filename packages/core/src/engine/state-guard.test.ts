import { describe, it, expect, beforeEach } from 'vitest';
import { StateGuard } from './state-guard.js';
import type { WorkflowDefinition } from '../types/workflow-definition.js';

const definition: WorkflowDefinition = {
  id: 'test-wf',
  name: 'Test Workflow',
  version: 1,
  initial_state: 'created',
  steps: {
    'step-one': {
      description: 'First step',
      execution: 'auto',
      allowed_from_states: ['created'],
      produces_state: 'step_one_done',
    },
    'step-two': {
      description: 'Second step',
      execution: 'agent',
      allowed_from_states: ['step_one_done'],
      produces_state: 'completed',
    },
  },
};

describe('StateGuard', () => {
  let guard: StateGuard;

  beforeEach(() => {
    guard = new StateGuard(definition);
  });

  it('isAllowed() returns true for a valid state transition', () => {
    expect(guard.isAllowed('step-one', 'created')).toBe(true);
    expect(guard.isAllowed('step-two', 'step_one_done')).toBe(true);
  });

  it('isAllowed() returns false for an invalid state', () => {
    expect(guard.isAllowed('step-one', 'step_one_done')).toBe(false);
    expect(guard.isAllowed('step-two', 'created')).toBe(false);
  });

  it('isAllowed() returns false for an unknown step name', () => {
    expect(guard.isAllowed('nonexistent-step', 'created')).toBe(false);
  });

  it('getBlockedReason() returns correct current_state and allowed_states', () => {
    const reason = guard.getBlockedReason('step-one', 'wrong_state');
    expect(reason.current_state).toBe('wrong_state');
    expect(reason.allowed_states).toContain('created');
    expect(reason.allowed_states).toHaveLength(1);
  });

  it('getAllowedStates() returns all allowed states for a step', () => {
    const states = guard.getAllowedStates('step-one');
    expect(states).toContain('created');
    expect(states).toHaveLength(1);
  });

  it('getAllowedStates() returns empty array for unknown step', () => {
    expect(guard.getAllowedStates('does-not-exist')).toEqual([]);
  });

  it('getAllowedSteps() returns steps that allow the given state', () => {
    const steps = guard.getAllowedSteps('created');
    expect(steps).toContain('step-one');
    expect(steps).not.toContain('step-two');
  });

  it('getAllowedSteps() returns empty array for an unknown state', () => {
    expect(guard.getAllowedSteps('unknown_state')).toEqual([]);
  });
});
