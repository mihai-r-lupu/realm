// run-agent.ts — Core agent loop logic, decoupled from the Commander handler for testability.
// Exports runAgent(), postGateNotificationToSlack(), AgentDeps, AgentRunOptions, and AgentRunResult.
import { join } from 'node:path';
import {
  loadWorkflowFromFile,
  findEligibleSteps,
  executeChain,
  buildNextActions,
  type RunStore,
  type WorkflowDefinition,
  type StepDefinition,
  type PendingGate,
  type ExtensionRegistry,
} from '@sensigo/realm';
import type { WorkflowRegistrar } from '@sensigo/realm';
import type { LlmProvider } from './llm-provider.js';

export type AgentRunResult = 'completed' | 'failed';

export interface AgentDeps {
  store: RunStore;
  workflowStore: WorkflowRegistrar;
  provider: LlmProvider;
  registry: ExtensionRegistry;
  /**
   * Override gate handling — replaces the default (print info + Slack notify + poll) path.
   * Provided by tests to resolve gates synchronously without real polling.
   */
  onGate?: (runId: string, gate: PendingGate, approveCmd: string) => Promise<void>;
}

export interface AgentRunOptions {
  /** Path to workflow.yaml file. Required when definition is not provided. */
  workflowPath?: string;
  /** Inline workflow definition — bypasses loadWorkflowFromFile when provided. */
  definition?: WorkflowDefinition;
  params: Record<string, unknown>;
  slackWebhookUrl?: string;
  /** Poll interval in ms. Defaults to 3000. Lower values are useful in tests. */
  pollIntervalMs?: number;
  /**
   * When true, persist the workflow definition to ~/.realm/workflows/ so that
   * `realm run inspect` and `realm run list` can resolve it by ID.
   * Defaults to false — realm agent does not register workflows as a side effect.
   */
  register?: boolean;
}

/**
 * POSTs a gate-waiting notification to a Slack Incoming Webhook.
 * Failure is warned but does not abort the workflow run.
 */
export async function postGateNotificationToSlack(
  webhookUrl: string,
  gate: PendingGate,
  approveCmd: string,
): Promise<void> {
  const body = {
    text: '⏸ Workflow gate waiting for approval',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Gate:* \`${gate.step_name}\`\n*Preview:* ${JSON.stringify(gate.preview)}\n\n*To approve, run:*\n\`\`\`${approveCmd}\`\`\``,
        },
      },
    ],
  };
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn(`  ⚠  Slack notification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function pollUntilGateResolved(
  store: RunStore,
  runId: string,
  gateId: string,
  intervalMs: number,
): Promise<void> {
  console.log('   Waiting for approval...');
  for (;;) {
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    const run = await store.get(runId);
    if (run.terminal_state) break;
    if (run.pending_gate === undefined || run.pending_gate.gate_id !== gateId) break;
  }
}

/**
 * Runs a workflow to completion using the provided dependencies.
 * Returns 'completed' when the run finishes normally; 'failed' otherwise.
 * Throws on setup failures (e.g. workflow file not found, provider error).
 */
export async function runAgent(
  deps: AgentDeps,
  options: AgentRunOptions,
): Promise<AgentRunResult> {
  // Load or use provided definition.
  const definition: WorkflowDefinition =
    options.definition !== undefined
      ? options.definition
      : loadWorkflowFromFile(
          options.workflowPath!.endsWith('.yaml') || options.workflowPath!.endsWith('.yml')
            ? options.workflowPath!
            : join(options.workflowPath!, 'workflow.yaml'),
        );

  // Register only when explicitly requested (--register flag).
  // By default realm agent does not write to ~/.realm/workflows/ as a side effect.
  if (options.register === true) {
    await deps.workflowStore.register(definition);
  }

  const initialRecord = await deps.store.create({
    workflowId: definition.id,
    workflowVersion: definition.version,
    params: options.params,
  });
  const runId = initialRecord.id;

  console.log(`\nRealm Agent — ${definition.name} v${definition.version}`);
  console.log(`Run ID: ${runId}\n`);

  let currentRun = await deps.store.get(runId);

  while (!currentRun.terminal_state) {
    // --- Gate handling ---
    if (currentRun.pending_gate !== undefined) {
      const gate = currentRun.pending_gate;
      const approveCmd = `realm run respond ${runId} --gate ${gate.gate_id} --choice approve`;

      console.log(`\n⏸  Gate: ${gate.step_name} | ID: ${gate.gate_id}`);
      console.log(`   Preview: ${JSON.stringify(gate.preview, null, 2)}`);
      console.log(`\n   Approve: ${approveCmd}`);

      if (deps.onGate !== undefined) {
        await deps.onGate(runId, gate, approveCmd);
      } else {
        if (options.slackWebhookUrl !== undefined) {
          await postGateNotificationToSlack(options.slackWebhookUrl, gate, approveCmd);
        }
        await pollUntilGateResolved(
          deps.store,
          runId,
          gate.gate_id,
          options.pollIntervalMs ?? 3000,
        );
      }

      currentRun = await deps.store.get(runId);
      continue;
    }

    // --- Step execution ---
    const eligible = findEligibleSteps(definition, currentRun);
    if (eligible.length === 0) break;

    const stepName = eligible[0]!;
    const stepDef: StepDefinition = definition.steps[stepName]!;

    let stepInput: Record<string, unknown>;

    if (stepDef.execution === 'agent') {
      // Resolve template-expanded prompt via buildNextActions so {{ context.resources.* }}
      // references are substituted before the LLM call.
      const nextActions = buildNextActions(definition, currentRun);
      const nextAction =
        nextActions.find(
          (a) =>
            a.instruction !== null &&
            (a.instruction.call_with['command'] as string | undefined) === stepName,
        ) ?? nextActions[0];

      const prompt = nextAction?.prompt ?? stepDef.description;
      const inputSchema =
        (nextAction?.input_schema as Record<string, unknown> | undefined) ??
        (stepDef.input_schema as Record<string, unknown> | undefined);

      const descPreview = stepDef.description.slice(0, 80);
      console.log(`\n→ [agent] ${stepName}`);
      console.log(`  ${descPreview}${stepDef.description.length > 80 ? '…' : ''}`);

      // Retry the LLM call once on failure before giving up.
      let callError: unknown;
      stepInput = {};
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          stepInput = await deps.provider.callStep(prompt, inputSchema);
          callError = undefined;
          break;
        } catch (err) {
          callError = err;
          console.warn(
            `  ⚠  LLM call attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (callError !== undefined) {
        console.error(`\n✗ Step '${stepName}' LLM call failed after 2 attempts`);
        return 'failed';
      }
    } else {
      // Auto step — the engine dispatches to the service adapter directly.
      console.log(`→ [auto] ${stepName}`);
      stepInput = {};
    }

    const result = await executeChain(deps.store, definition, {
      runId,
      command: stepName,
      input: stepInput,
      dispatcher: async () => stepInput,
      registry: deps.registry,
    });

    if (result.status === 'error') {
      console.error(`\n✗ Step '${stepName}' failed: ${result.errors.join(', ')}`);
      return 'failed';
    }

    if (result.status === 'confirm_required') {
      // Gate will be handled at the top of the next iteration.
      currentRun = await deps.store.get(runId);
      continue;
    }

    currentRun = await deps.store.get(runId);
    console.log(`  ✓ → ${currentRun.run_phase}`);
  }

  if (currentRun.run_phase === 'completed') {
    console.log(`\nRun complete: ${runId}`);
    return 'completed';
  }

  console.error(`\nRun ended in phase: ${currentRun.run_phase}`);
  return 'failed';
}
