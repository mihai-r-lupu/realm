/**
 * ValidateVerbatimQuotesHandler — verifies extracted verbatim quotes exist in the source document.
 *
 * Composes the handler primitives: resolveResource, walkField, partitionBySubstring, countResults.
 */
import type {
  StepHandler,
  StepHandlerInputs,
  StepContext,
  StepHandlerResult,
} from '../extensions/step-handler.js';
import { resolveResource } from './primitives/resolve-resource.js';
import { walkField } from './primitives/walk-field.js';
import { partitionBySubstring } from './primitives/partition-by-substring.js';
import { countResults } from './primitives/count-results.js';

export class ValidateVerbatimQuotesHandler implements StepHandler {
  readonly id = 'validate_verbatim_quotes';

  async execute(inputs: StepHandlerInputs, context: StepContext): Promise<StepHandlerResult> {
    const { source_step, source_field, quote_field } = context.config;

    if (typeof source_step !== 'string') {
      throw new Error('config.source_step is required and must be a string');
    }

    const resolvedSourceField = typeof source_field === 'string' ? source_field : 'text';
    const resolvedQuoteField = typeof quote_field === 'string' ? quote_field : 'verbatim_quote';

    const sourceText = resolveResource(context.resources, source_step, resolvedSourceField);
    if (typeof sourceText !== 'string') {
      throw new Error(
        'source text is missing or not a string — check config.source_step and config.source_field',
      );
    }

    const rawCandidates = inputs.params.candidates;
    if (!Array.isArray(rawCandidates)) {
      throw new Error('inputs.params.candidates must be an array');
    }

    const candidates = rawCandidates as Record<string, unknown>[];
    const walked = walkField(candidates, resolvedQuoteField);
    const { accepted, rejected } = partitionBySubstring(walked, resolvedQuoteField, sourceText);
    const { accepted_count, rejected_count, candidates_found } = countResults(accepted, rejected);

    return {
      data: {
        accepted,
        rejected,
        accepted_count,
        rejected_count,
        candidates_found,
      },
    };
  }
}
