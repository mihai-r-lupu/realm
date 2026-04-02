import { describe, it, expect } from 'vitest';
import { validateInputSchema } from './input-schema.js';
import { WorkflowError } from '../types/workflow-error.js';
import type { JsonSchema } from '../types/workflow-definition.js';

const schema: JsonSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
  },
};

describe('validateInputSchema', () => {
  it('valid input (matching schema) does not throw', () => {
    expect(() => validateInputSchema({ name: 'Alice' }, schema, 'my-step')).not.toThrow();
  });

  it('missing required field throws WorkflowError with code VALIDATION_INPUT_SCHEMA', () => {
    expect(() => validateInputSchema({}, schema, 'my-step')).toThrow(WorkflowError);
    try {
      validateInputSchema({}, schema, 'my-step');
    } catch (err) {
      expect((err as WorkflowError).code).toBe('VALIDATION_INPUT_SCHEMA');
    }
  });

  it('wrong type throws WorkflowError with code VALIDATION_INPUT_SCHEMA', () => {
    expect(() => validateInputSchema({ name: 42 }, schema, 'my-step')).toThrow(WorkflowError);
    try {
      validateInputSchema({ name: 42 }, schema, 'my-step');
    } catch (err) {
      expect((err as WorkflowError).code).toBe('VALIDATION_INPUT_SCHEMA');
    }
  });

  it('agentAction on the thrown error is provide_input', () => {
    try {
      validateInputSchema({}, schema, 'my-step');
    } catch (err) {
      expect((err as WorkflowError).agentAction).toBe('provide_input');
    }
  });

  it('stepId on the thrown error matches the argument', () => {
    try {
      validateInputSchema({}, schema, 'target-step');
    } catch (err) {
      expect((err as WorkflowError).stepId).toBe('target-step');
    }
  });
});
