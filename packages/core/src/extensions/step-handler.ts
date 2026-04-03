// Step handler — custom business logic for a workflow step.

export interface StepHandlerInputs {
  params: Record<string, unknown>;
}

export interface StepContext {
  run_id: string;
  run_params: Record<string, unknown>;
  config: Record<string, unknown>;
  /**
   * Outputs from prior steps in the run, keyed by step_id.
   * Use this to access document text, extracted candidates, or any data
   * produced by earlier auto or agent steps in the same run.
   */
  resources?: Record<string, unknown>;
}

export interface StepHandlerResult {
  data: Record<string, unknown>;
  state_update?: Record<string, unknown>;
}

export interface StepHandler {
  readonly id: string;
  execute(inputs: StepHandlerInputs, context: StepContext): Promise<StepHandlerResult>;
}
