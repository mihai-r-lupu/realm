// start-run tool — creates a new run and chains through initial auto steps.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  JsonWorkflowStore,
  JsonFileStore,
  StateGuard,
  executeChain,
  type StepDispatcher,
  type ResponseEnvelope,
} from '@sensigo/realm';

export interface HandleRunStores {
  runStore?: JsonFileStore;
  workflowStore?: JsonWorkflowStore;
}

/**
 * stubDispatcher — returns {} for all steps.
 * Auto steps in Phase 2 do not perform real external work. This stub is the
 * seam where real handler implementations will plug in during Phase 3.
 */
const stubDispatcher: StepDispatcher = async () => ({});

/**
 * Business logic for the start_run tool.
 * Creates a run and immediately chains through any leading auto steps.
 */
export async function handleStartRun(
  args: { workflow_id: string; params?: Record<string, unknown> },
  stores?: HandleRunStores,
): Promise<{
  run_id: string;
  status: string;
  data: Record<string, unknown>;
  next_action: ResponseEnvelope['next_action'];
  gate: ResponseEnvelope['gate'];
  errors: string[];
}> {
  const workflowStore = stores?.workflowStore ?? new JsonWorkflowStore();
  const runStore = stores?.runStore ?? new JsonFileStore();
  const definition = await workflowStore.get(args.workflow_id);
  const guard = new StateGuard(definition);
  const params = args.params ?? {};

  const run = await runStore.create({
    workflowId: definition.id,
    workflowVersion: definition.version,
    initialState: definition.initial_state,
    params,
  });

  const nextSteps = guard.getAllowedSteps(definition.initial_state);
  const firstStep = nextSteps[0];

  if (firstStep === undefined) {
    return {
      run_id: run.id,
      status: 'ok',
      data: {},
      next_action: null,
      gate: undefined,
      errors: [],
    };
  }

  const result = await executeChain(runStore, guard, definition, {
    runId: run.id,
    command: firstStep,
    input: params,
    snapshotId: run.version.toString(),
    dispatcher: stubDispatcher,
  });

  return {
    run_id: run.id,
    status: result.status,
    data: result.data,
    next_action: result.next_action,
    gate: result.gate,
    errors: result.errors,
  };
}

/** Registers the start_run MCP tool on the server. */
export function registerStartRun(server: McpServer): void {
  server.tool(
    'start_run',
    'Create a new workflow run and chain through initial auto steps.',
    {
      workflow_id: z.string(),
      params: z.record(z.unknown()).optional().default({}),
    },
    async (args) => {
      try {
        const result = await handleStartRun(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
