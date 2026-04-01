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
export const VERSION = '0.1.0';
