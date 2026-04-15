// respond command — submits a human gate response for a gate-waiting run.
import { Command } from 'commander';
import type { RunStore } from '@sensigo/realm';
import type { WorkflowRegistrar } from '@sensigo/realm';
import { WorkflowError, submitHumanResponse } from '@sensigo/realm';

/**
 * Submits a human choice response for a gate-waiting run.
 * @param runId         The run awaiting a gate response.
 * @param options       `gate` is the gate_id; `choice` is the selected option.
 * @param runStore      Store holding run records.
 * @param workflowStore Registrar for workflow definitions.
 * @returns The choice submitted and the new run state after the gate advances.
 */
export async function respondToGate(
  runId: string,
  options: { gate: string; choice: string },
  runStore: RunStore,
  workflowStore: WorkflowRegistrar,
): Promise<{ choice: string; newState: string }> {
  const run = await runStore.get(runId);
  const workflow = await workflowStore.get(run.workflow_id);

  const result = await submitHumanResponse(runStore, workflow, {
    runId,
    gateId: options.gate,
    choice: options.choice,
  });

  if (result.status !== 'ok') {
    throw new WorkflowError(result.errors[0] ?? 'Gate response failed', {
      code: 'STATE_BLOCKED',
      category: 'STATE',
      agentAction: 'report_to_user',
      retryable: false,
    });
  }

  const updatedRun = await runStore.get(runId);
  return { choice: options.choice, newState: updatedRun.run_phase };
}

export const respondCommand = new Command('respond')
  .description('Submit a human gate response to advance a gate-waiting run')
  .argument('<run-id>', 'ID of the run waiting at a gate')
  .requiredOption('--gate <gate-id>', 'Gate ID from the confirm_required response')
  .requiredOption('--choice <choice>', 'The choice to submit (e.g. approve, reject)')
  .action(async (runId: string, opts: { gate: string; choice: string }) => {
    const { JsonFileStore, JsonWorkflowStore } = await import('@sensigo/realm');
    const runStore = new JsonFileStore();
    const workflowStore = new JsonWorkflowStore();
    try {
      const { choice, newState } = await respondToGate(runId, opts, runStore, workflowStore);
      console.log(`Responded: ${runId} | choice '${choice}' | new state '${newState}'`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
