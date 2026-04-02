// resume command — resets a failed or abandoned run to a state where a specific step is allowed.
import { Command } from 'commander';
import type { RunStore } from '@sensigo/realm';
import type { WorkflowRegistrar } from '@sensigo/realm';
import { WorkflowError } from '@sensigo/realm';
import { RESUMABLE_STATES } from '@sensigo/realm';

/**
 * Resets a run to a state where `from` step is allowed again.
 * @param runId   The run to resume.
 * @param options `from` is the step name to re-enable; `state` overrides the target state
 *                when the step allows multiple source states.
 * @param runStore       Store holding run records.
 * @param workflowStore  Registrar for workflow definitions.
 * @returns The state the run was reset to.
 */
export async function resumeRun(
  runId: string,
  options: { from: string; state?: string },
  runStore: RunStore,
  workflowStore: WorkflowRegistrar,
): Promise<{ resetState: string }> {
  const run = await runStore.get(runId);

  if (!RESUMABLE_STATES.has(run.state)) {
    throw new WorkflowError(
      `Run ${runId} is in state '${run.state}', which is not resumable.`,
      {
        code: 'STATE_TRANSITION_DENIED',
        category: 'STATE',
        agentAction: 'report_to_user',
        retryable: false,
      },
    );
  }

  const workflow = await workflowStore.get(run.workflow_id);

  const stepDef = workflow.steps[options.from];
  if (stepDef === undefined) {
    throw new WorkflowError(`Step '${options.from}' not found in workflow '${run.workflow_id}'.`, {
      code: 'STEP_NOT_FOUND',
      category: 'ENGINE',
      agentAction: 'report_to_user',
      retryable: false,
    });
  }

  let resetState: string;
  if (options.state !== undefined) {
    if (!stepDef.allowed_from_states.includes(options.state)) {
      const joined = stepDef.allowed_from_states.join(', ');
      throw new WorkflowError(
        `State '${options.state}' is not in allowed_from_states for step '${options.from}': [${joined}].`,
        {
          code: 'STATE_TRANSITION_DENIED',
          category: 'STATE',
          agentAction: 'report_to_user',
          retryable: false,
        },
      );
    }
    resetState = options.state;
  } else if (stepDef.allowed_from_states.length === 1) {
    resetState = stepDef.allowed_from_states[0]!;
  } else {
    const joined = stepDef.allowed_from_states.join(', ');
    throw new WorkflowError(
      `Step '${options.from}' allows from multiple states: [${joined}]. Specify with --state`,
      {
        code: 'STATE_TRANSITION_DENIED',
        category: 'STATE',
        agentAction: 'report_to_user',
        retryable: false,
      },
    );
  }

  // Strip terminal_reason when resuming so the record no longer looks terminal.
  const { terminal_reason: _tr, ...rest } = run;
  await runStore.update({ ...rest, state: resetState, terminal_state: false });

  return { resetState };
}

export const resumeCommand = new Command('resume')
  .description('Reset a failed or abandoned run so the specified step can execute again')
  .argument('<run-id>', 'ID of the run to resume')
  .requiredOption('--from <step>', 'Name of the step to re-enable')
  .option('--state <state>', 'Override the target state (required when step allows multiple from-states)')
  .action(async (runId: string, opts: { from: string; state?: string }) => {
    const { JsonFileStore, JsonWorkflowStore } = await import('@sensigo/realm');
    const runStore = new JsonFileStore();
    const workflowStore = new JsonWorkflowStore();
    try {
      const { resetState } = await resumeRun(runId, opts, runStore, workflowStore);
      console.log(`Resumed: ${runId} → state '${resetState}'. Step '${opts.from}' is now allowed.`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
