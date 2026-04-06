// handlers.ts — step handlers for the document-intake workflow.
import { WorkflowError } from '@sensigo/realm';
import type { StepHandler, StepHandlerInputs, StepContext, StepHandlerResult } from '@sensigo/realm';

/**
 * Validates extracted intake fields against quality requirements.
 * Throws WorkflowError with agentAction: 'provide_input' if any field fails.
 */
export class ValidateIntakeFieldsHandler implements StepHandler {
  readonly id = 'validate_intake_fields';

  async execute(inputs: StepHandlerInputs, _context: StepContext): Promise<StepHandlerResult> {
    const params = inputs.params as {
      title?: unknown;
      author?: unknown;
      date?: unknown;
      summary?: unknown;
    };

    if (typeof params.title !== 'string' || params.title.trim() === '') {
      throw new WorkflowError('title is required and must be a non-empty string', {
        category: 'VALIDATION',
        code: 'STEP_HANDLER_ERROR',
        agentAction: 'provide_input',
        retryable: false,
      });
    }

    if (typeof params.author !== 'string' || params.author.trim() === '') {
      throw new WorkflowError('author is required and must be a non-empty string', {
        category: 'VALIDATION',
        code: 'STEP_HANDLER_ERROR',
        agentAction: 'provide_input',
        retryable: false,
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof params.date !== 'string' || !dateRegex.test(params.date)) {
      throw new WorkflowError('date must be in YYYY-MM-DD format', {
        category: 'VALIDATION',
        code: 'STEP_HANDLER_ERROR',
        agentAction: 'provide_input',
        retryable: false,
      });
    }

    const dateObj = new Date(params.date);
    if (isNaN(dateObj.getTime())) {
      throw new WorkflowError('date is not a valid calendar date', {
        category: 'VALIDATION',
        code: 'STEP_HANDLER_ERROR',
        agentAction: 'provide_input',
        retryable: false,
      });
    }

    if (typeof params.summary !== 'string' || params.summary.length < 20) {
      throw new WorkflowError('summary must be at least 20 characters', {
        category: 'VALIDATION',
        code: 'STEP_HANDLER_ERROR',
        agentAction: 'provide_input',
        retryable: false,
      });
    }

    return { data: { validated: true, title: params.title, author: params.author, date: params.date } };
  }
}
