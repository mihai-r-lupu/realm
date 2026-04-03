// @sensigo/realm — core workflow execution engine
export * from './types/run-record.js';
export * from './types/response-envelope.js';
export * from './types/workflow-error.js';
export * from './types/workflow-definition.js';
export * from './store/store-interface.js';
export { JsonFileStore } from './store/json-file-store.js';
export { StateGuard } from './engine/state-guard.js';
export { executeStep } from './engine/execution-loop.js';
export type { StepDispatcher, ExecuteStepOptions } from './engine/execution-loop.js';
export {
    findNextAction,
    submitHumanResponse,
    executeChain,
} from './engine/execution-loop.js';
export type { SubmitGateOptions, ExecuteChainOptions } from './engine/execution-loop.js';
export { TERMINAL_STATES, RESUMABLE_STATES, WAITING_STATES, isTerminalState } from './engine/lifecycle.js';
export {
    evaluatePrecondition,
    checkPreconditions,
} from './engine/precondition.js';
export type { PreconditionResult } from './engine/precondition.js';
export const VERSION = '0.1.0';

// Extensions
export type { ServiceAdapter, ServiceResponse } from './extensions/service-adapter.js';
export type { Processor, ProcessorInput, ProcessorOutput } from './extensions/processor.js';
export type { StepHandler, StepHandlerInputs, StepContext, StepHandlerResult } from './extensions/step-handler.js';
export { ExtensionRegistry } from './extensions/registry.js';

// Evidence
export { captureEvidence } from './evidence/snapshot.js';
export type { CaptureEvidenceParams } from './evidence/snapshot.js';

// Pipeline
export { runPipeline } from './pipeline/processing-pipeline.js';
export type { PipelineResult } from './pipeline/processing-pipeline.js';

// Adapters
export { MockAdapter } from './adapters/mock-adapter.js';
export { GenericHttpAdapter } from './adapters/http-adapter.js';
export type { HttpAdapterConfig } from './adapters/http-adapter.js';

// Processors (built-ins)
export { normalizeText } from './processors/normalize-text.js';
export { computeHash } from './processors/compute-hash.js';

// Validation
export { validateInputSchema } from './validation/input-schema.js';

// Config
export { loadSecrets, resolveSecret } from './config/secrets.js';

// Workflow
export { loadWorkflowFromFile, loadWorkflowFromString } from './workflow/yaml-loader.js';
export { JsonWorkflowStore } from './workflow/registrar.js';
export type { WorkflowRegistrar } from './workflow/registrar.js';
