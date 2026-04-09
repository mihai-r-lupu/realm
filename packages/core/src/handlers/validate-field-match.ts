/**
 * ValidateFieldMatchHandler — checks that a field from a prior step's output satisfies a string pattern.
 *
 * Uses resolveResource and compareStrings primitives. Returns matched: false on mismatch — does not throw.
 */
import type {
  StepHandler,
  StepHandlerInputs,
  StepContext,
  StepHandlerResult,
} from '../extensions/step-handler.js';
import { resolveResource } from './primitives/resolve-resource.js';
import { compareStrings } from './primitives/compare-strings.js';

const VALID_MODES = ['exact', 'prefix', 'regex'] as const;
type Mode = (typeof VALID_MODES)[number];

export class ValidateFieldMatchHandler implements StepHandler {
  readonly id = 'validate_field_match';

  async execute(_inputs: StepHandlerInputs, context: StepContext): Promise<StepHandlerResult> {
    const { source_step, source_field, pattern, mode: rawMode } = context.config;

    if (typeof source_step !== 'string') {
      throw new Error('config.source_step is required and must be a string');
    }
    if (typeof source_field !== 'string') {
      throw new Error('config.source_field is required and must be a string');
    }
    if (typeof pattern !== 'string') {
      throw new Error('config.pattern is required and must be a string');
    }

    let mode: Mode = 'exact';
    if (rawMode !== undefined) {
      if (!VALID_MODES.includes(rawMode as Mode)) {
        throw new Error('config.mode must be "exact", "prefix", or "regex"');
      }
      mode = rawMode as Mode;
    }

    const value = resolveResource(context.resources, source_step, source_field);
    if (typeof value !== 'string') {
      throw new Error(
        'field value is missing or not a string — check config.source_step and config.source_field',
      );
    }

    const matched = compareStrings(value, pattern, mode);

    return {
      data: {
        matched,
        value,
        pattern,
        mode,
      },
    };
  }
}
