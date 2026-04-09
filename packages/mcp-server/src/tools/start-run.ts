// start-run tool — creates a new run and chains through initial auto steps.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  JsonWorkflowStore,
  JsonFileStore,
  StateGuard,
  executeChain,
  findNextAction,
  type StepDispatcher,
  type ResponseEnvelope,
  ExtensionRegistry,
} from '@sensigo/realm';

export interface HandleRunStores {
  runStore?: JsonFileStore;
  workflowStore?: JsonWorkflowStore;
  /** Extension registry for resolving service adapters and step handlers. */
  registry?: ExtensionRegistry;
  /** Resolved secrets for use by service adapters. */
  secrets?: Record<string, string>;
}

// Fallback dispatcher for agent steps and auto steps without a registry entry.
// For auto steps that have uses_service or handler, the engine resolves them
// from the registry instead of calling this dispatcher.
const passthroughDispatcher: StepDispatcher = async () => ({});

/**
 * Business logic for the start_run tool.
 * Creates a run and immediately chains through any leading auto steps.
 */
export async function handleStartRun(
  args: { workflow_id: string; params?: Record<string, unknown> },
  stores?: HandleRunStores,
): Promise<ResponseEnvelope> {
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
      command: 'start_run',
      run_id: run.id,
      snapshot_id: run.version.toString(),
      status: 'ok',
      data: {},
      evidence: [],
      warnings: [],
      errors: [],
      context_hint: `Run '${run.id}' created. No steps available from state '${definition.initial_state}'.`,
      next_action: null,
    };
  }

  const firstStepDef = definition.steps[firstStep];
  if (firstStepDef?.execution !== 'auto') {
    const nextAction = findNextAction(run.state, definition, {
      evidenceByStep: {},
      runParams: params,
      runId: run.id,
    });
    return {
      command: 'start_run',
      run_id: run.id,
      snapshot_id: run.version.toString(),
      status: 'ok',
      data: {},
      evidence: [],
      warnings: [],
      errors: [],
      context_hint: nextAction?.orientation ?? `Run '${run.id}' created in state '${run.state}'.`,
      next_action: nextAction,
    };
  }

  const result = await executeChain(runStore, guard, definition, {
    runId: run.id,
    command: firstStep,
    input: params,
    snapshotId: run.version.toString(),
    dispatcher: passthroughDispatcher,
    ...(stores?.registry !== undefined ? { registry: stores.registry } : {}),
    ...(stores?.secrets !== undefined ? { secrets: stores.secrets } : {}),
  });

  return {
    ...result,
    run_id: run.id,
    data: {},
    evidence: [],
  };
}

/** Registers the start_run MCP tool on the server. */
export function registerStartRun(
  server: McpServer,
  opts?: {
    registry?: import('@sensigo/realm').ExtensionRegistry;
    secrets?: Record<string, string>;
  },
): void {
  server.tool(
    'start_run',
    'Create a new workflow run and chain through initial auto steps.',
    {
      workflow_id: z.string(),
      params: z.record(z.unknown()).optional().default({}),
    },
    async (args) => {
      try {
        const result = await handleStartRun(args, opts);
        // command is intentionally overridden to 'start_run': MCP callers invoked start_run, not
        // the first auto step that executeChain happened to execute. Do not revert this override.
        const { snapshot_id: _snap, ...slimResult } = { ...result, command: 'start_run' };
        return { content: [{ type: 'text' as const, text: JSON.stringify(slimResult, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  command: 'start_run',
                  run_id: '',
                  status: 'error',
                  data: {},
                  evidence: [],
                  warnings: [],
                  errors: [message],
                  agent_action: 'stop',
                  context_hint: `Error creating run for workflow '${args.workflow_id}'.`,
                  next_action: null,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );
}
