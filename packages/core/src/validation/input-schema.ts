// Input schema validation — validates step input against a declared JSON Schema using Ajv.
import { Ajv } from 'ajv';
import type { JsonSchema } from '../types/workflow-definition.js';
import { WorkflowError } from '../types/workflow-error.js';

/**
 * Validates input against the step's declared JSON Schema.
 * Throws WorkflowError(VALIDATION_INPUT_SCHEMA) on failure.
 */
export function validateInputSchema(
  input: Record<string, unknown>,
  schema: JsonSchema,
  stepId: string,
): void {
  const ajv = new Ajv();
  const valid = ajv.validate(schema as object, input);
  if (!valid) {
    throw new WorkflowError(`Invalid input for step '${stepId}'`, {
      code: 'VALIDATION_INPUT_SCHEMA',
      category: 'VALIDATION',
      agentAction: 'provide_input',
      retryable: false,
      details: { errors: ajv.errors ?? [] },
      stepId,
    });
  }
}
