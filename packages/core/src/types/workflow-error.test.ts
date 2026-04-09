import { describe, it, expect } from 'vitest';
import { WorkflowError } from './workflow-error.js';
import type { ErrorCategory } from './workflow-error.js';

const ALL_CATEGORIES: ErrorCategory[] = [
  'NETWORK',
  'SERVICE',
  'STATE',
  'VALIDATION',
  'ENGINE',
  'RESOURCE',
];

describe('WorkflowError', () => {
  it('is instanceof Error', () => {
    const err = new WorkflowError('test', {
      code: 'ENGINE_INTERNAL',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
    expect(err).toBeInstanceOf(Error);
  });

  it('has name === WorkflowError', () => {
    const err = new WorkflowError('test', {
      code: 'STATE_BLOCKED',
      category: 'STATE',
      agentAction: 'report_to_user',
      retryable: false,
    });
    expect(err.name).toBe('WorkflowError');
  });

  it('sets all fields correctly', () => {
    const err = new WorkflowError('oops', {
      code: 'VALIDATION_HASH_MISMATCH',
      category: 'VALIDATION',
      agentAction: 'provide_input',
      retryable: true,
      details: { field: 'x' },
      stepId: 'step-1',
      attempt: 3,
    });
    expect(err.code).toBe('VALIDATION_HASH_MISMATCH');
    expect(err.category).toBe('VALIDATION');
    expect(err.agentAction).toBe('provide_input');
    expect(err.retryable).toBe(true);
    expect(err.details).toEqual({ field: 'x' });
    expect(err.stepId).toBe('step-1');
    expect(err.attempt).toBe(3);
  });

  it('defaults details to empty object when not provided', () => {
    const err = new WorkflowError('test', {
      code: 'ENGINE_INTERNAL',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
    expect(err.details).toEqual({});
  });

  it('defaults attempt to 1 when not provided', () => {
    const err = new WorkflowError('test', {
      code: 'ENGINE_INTERNAL',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
    expect(err.attempt).toBe(1);
  });

  it('timestamp is a valid ISO 8601 string', () => {
    const err = new WorkflowError('test', {
      code: 'ENGINE_INTERNAL',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
    expect(() => new Date(err.timestamp)).not.toThrow();
    expect(new Date(err.timestamp).toISOString()).toBe(err.timestamp);
  });

  it.each(ALL_CATEGORIES)('can be constructed with category %s', (category) => {
    const err = new WorkflowError('cat test', {
      code: 'ENGINE_INTERNAL',
      category,
      agentAction: 'stop',
      retryable: false,
    });
    expect(err.category).toBe(category);
  });
});
