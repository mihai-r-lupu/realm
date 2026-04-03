// testStepHandler — isolated step handler test helper.
import type { StepHandler, StepHandlerInputs, StepContext, StepHandlerResult } from '@sensigo/realm';

/**
 * Calls handler.execute(inputs, context) and returns the result.
 * context defaults to { run_id: 'test-run', run_params: {}, config: {} } if not provided.
 */
export async function testStepHandler(
  handler: StepHandler,
  inputs: StepHandlerInputs,
  context?: Partial<StepContext>,
): Promise<StepHandlerResult> {
  const fullContext: StepContext = {
    run_id: 'test-run',
    run_params: {},
    config: {},
    ...context,
  };
  return handler.execute(inputs, fullContext);
}
