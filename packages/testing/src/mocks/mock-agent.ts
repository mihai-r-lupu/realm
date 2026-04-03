// createAgentDispatcher — test dispatcher using pre-built responses and registry lookups.
import {
  WorkflowError,
  type StepDispatcher,
  type WorkflowDefinition,
  type ExtensionRegistry,
} from '@sensigo/realm';

/**
 * Creates a StepDispatcher for use in tests.
 *
 * Dispatch priority per step:
 *   1. execution: 'agent' → returns agentResponses[stepName]; throws ENGINE_HANDLER_FAILED if absent
 *   2. handler → calls handler.execute() from registry (or fallbackRegistry); throws if not found
 *   3. uses_service → calls adapter.fetch() from registry (or fallbackRegistry); throws if not found
 *   4. none of the above → returns {}
 *
 * If stepDef is undefined (step name not in definition), returns {} without throwing.
 *
 * @param fallbackRegistry Optional secondary registry searched when the primary registry
 *   has no match. Useful for merging per-fixture mock adapters with caller-provided handlers.
 */
export function createAgentDispatcher(
  definition: WorkflowDefinition,
  registry: ExtensionRegistry,
  agentResponses: Record<string, Record<string, unknown>>,
  fallbackRegistry?: ExtensionRegistry,
): StepDispatcher {
  return async (stepName, input, run) => {
    const stepDef = definition.steps[stepName];
    if (stepDef === undefined) {
      return {};
    }

    if (stepDef.execution === 'agent') {
      const response = agentResponses[stepName];
      if (response === undefined) {
        throw new WorkflowError(
          `createAgentDispatcher: no pre-built response for agent step '${stepName}'`,
          {
            code: 'ENGINE_HANDLER_FAILED',
            category: 'ENGINE',
            agentAction: 'report_to_user',
            retryable: false,
          },
        );
      }
      return response;
    }

    if (stepDef.handler !== undefined) {
      const handler =
        registry.getHandler(stepDef.handler) ??
        fallbackRegistry?.getHandler(stepDef.handler);
      if (handler === undefined) {
        throw new WorkflowError(
          `createAgentDispatcher: no handler registered for '${stepDef.handler}'`,
          {
            code: 'ENGINE_HANDLER_FAILED',
            category: 'ENGINE',
            agentAction: 'report_to_user',
            retryable: false,
          },
        );
      }
      const result = await handler.execute(
        { params: input },
        { run_id: run.id, run_params: run.params, config: {} },
      );
      return result.data;
    }

    if (stepDef.uses_service !== undefined) {
      const serviceDef = definition.services?.[stepDef.uses_service];
      const adapterId = serviceDef?.adapter;
      const adapter =
        adapterId !== undefined
          ? (registry.getAdapter(adapterId) ?? fallbackRegistry?.getAdapter(adapterId))
          : undefined;
      if (adapter === undefined) {
        throw new WorkflowError(
          `createAgentDispatcher: no adapter registered for service '${stepDef.uses_service}'`,
          {
            code: 'ENGINE_ADAPTER_FAILED',
            category: 'ENGINE',
            agentAction: 'report_to_user',
            retryable: false,
          },
        );
      }
      const resp = await adapter.fetch(stepName, input, {});
      return resp.data as Record<string, unknown>;
    }

    return {};
  };
}
