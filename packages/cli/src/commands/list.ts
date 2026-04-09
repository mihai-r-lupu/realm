// list command — displays all runs in the store, sorted by most recent first.
import chalk from 'chalk';
import { Command } from 'commander';
import type { RunStore, RunRecord } from '@sensigo/realm';

/** Returns a chalk-coloured state label. */
function colorState(run: RunRecord): string {
  if (!run.terminal_state) {
    if (run.state === 'gate_waiting') return chalk.cyan(run.state);
    return chalk.yellow(run.state);
  }
  if (run.state === 'completed') return chalk.green(run.state);
  return chalk.red(run.state);
}

/**
 * Lists all runs from the store, sorted by updated_at descending.
 * @param workflowId  Optional filter — only show runs from this workflow.
 * @param store       Store holding run records.
 * @returns           Formatted output string.
 */
export async function listRuns(workflowId: string | undefined, store: RunStore): Promise<string> {
  const runs = await store.list(workflowId);

  if (runs.length === 0) {
    return workflowId !== undefined
      ? `No runs found for workflow '${workflowId}'.`
      : 'No runs found.';
  }

  runs.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const lines: string[] = [];
  for (const run of runs) {
    const state = colorState(run);
    const updated = new Date(run.updated_at).toLocaleString();
    const steps = new Set(
      run.evidence.filter((e) => e.kind !== 'gate_response').map((e) => e.step_id),
    ).size;
    lines.push(
      `${chalk.dim(run.id)}  ${chalk.bold(run.workflow_id)} v${run.workflow_version}  ${state}  ${updated}  ${steps} step(s)`,
    );
  }

  return lines.join('\n');
}

export const listCommand = new Command('list')
  .description('List all runs, sorted by most recent first')
  .option('--workflow <id>', 'Filter by workflow ID')
  .action(async (opts: { workflow?: string }) => {
    const { JsonFileStore } = await import('@sensigo/realm');
    const store = new JsonFileStore();
    try {
      const output = await listRuns(opts.workflow, store);
      console.log(output);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
