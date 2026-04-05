// execute-step tool — calls executeChain for an agent step with the agent's params as output.
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
import type { HandleRunStores } from './start-run.js';

/** Strips verbose I/O summaries and diagnostics from evidence entries for MCP responses. */
function slimEvidence(evidence: ResponseEnvelope['evidence']): unknown[] {
  return evidence.map(snap => ({
    step_id: snap.step_id,
    status: snap.status,
    duration_ms: snap.duration_ms,
    evidence_hash: snap.evidence_hash,
    ...(snap.attempt !== undefined ? { attempt: snap.attempt } : {}),
    ...(snap.error !== undefined ? { error: snap.error } : {}),
  }));
}

/**
 * Business logic for the execute_step tool.
 * For agent steps: the agent's params ARE the step output — the result of their work.
 * For auto steps: params is typically {} and the step is handled by the engine.
 * The dispatcher passes params through as the step output in both cases.
 */
export async function handleExecuteStep(
  args: { run_id: string; command: string; params?: Record<string, unknown> },
  stores?: HandleRunStores,
): Promise<ResponseEnvelope> {
  const workflowStore = stores?.workflowStore ?? new JsonWorkflowStore();
  const runStore = stores?.runStore ?? new JsonFileStore();
  const run = await runStore.get(args.run_id);
  const definition = await workflowStore.get(run.workflow_id);
  const guard = new StateGuard(definition);
  const params = args.params ?? {};

  // For agent steps, the agent's params represent their work output.
  // For auto steps, params is ignored and the engine handles execution.
  const dispatcher: StepDispatcher = async () => params;

  return executeChain(runStore, guard, definition, {
    runId: args.run_id,
    command: args.command,
    input: params,
    snapshotId: run.version.toString(),
    dispatcher,
    ...(stores?.registry !== undefined ? { registry: stores.registry } : {}),
    ...(stores?.secrets !== undefined ? { secrets: stores.secrets } : {}),
  });
}

/**
 * MCP tool handler for execute_step.
 * Calls handleExecuteStep and serialises the result for MCP transport,
 * stripping the data payload to avoid oversized responses.
 */
export async function handleExecuteStepTool(
  args: { run_id: string; command: string; params?: Record<string, unknown> },
  opts?: HandleRunStores,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const result = await handleExecuteStep(args, opts);
    const slimResult = { ...result, data: {}, evidence: slimEvidence(result.evidence) };
    return { content: [{ type: 'text' as const, text: JSON.stringify(slimResult, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{
        type: 'text' as const, text: JSON.stringify({
          command: args.command,
          run_id: args.run_id,
          snapshot_id: '',
          status: 'error',
          data: {},
          evidence: [],
          warnings: [],
          errors: [message],
          agent_action: 'stop',
          next_action: null,
        }, null, 2)
      }],
    };
  }
}

/** Registers the execute_step MCP tool on the server. */
export function registerExecuteStep(server: McpServer, opts?: { registry?: import('@sensigo/realm').ExtensionRegistry; secrets?: Record<string, string> }): void {
  server.tool(
    'execute_step',
    'Execute a workflow step. For agent steps, pass your output in params.',
    {
      run_id: z.string(),
      command: z.string(),
      params: z.record(z.unknown()).optional().default({}),
    },
    async (args) => handleExecuteStepTool(args, opts),
  );
}
