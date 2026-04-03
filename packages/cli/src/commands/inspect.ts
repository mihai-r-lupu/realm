// inspect command — displays the full evidence chain and diagnostics for a run.
import chalk from 'chalk';
import { Command } from 'commander';
import type { RunStore, RunRecord, WorkflowRegistrar, EvidenceSnapshot, StepDiagnostics } from '@sensigo/realm';

/** Formats a diagnostics object into a readable string for the inspect output. */
function formatDiagnostics(diag: StepDiagnostics): string {
  const tokens = `~${diag.input_token_estimate} tokens`;
  if (diag.precondition_trace.length === 0) {
    return `${tokens} | no preconditions`;
  }
  const traceStr = diag.precondition_trace
    .map((t) => `${t.expression} \u2192 ${t.passed ? 'true' : 'false'} (${String(t.resolved_value)})`)
    .join(', ');
  return `${tokens} | preconditions: ${traceStr}`;
}

/** Applies chalk color to a step status string. */
function colorStatus(status: string): string {
  if (status === 'success') return chalk.green(status);
  if (status === 'error') return chalk.red(status);
  return chalk.yellow(status);
}

/**
 * Formats and returns a colored inspection report for a workflow run.
 * @param runId         The ID of the run to inspect.
 * @param store         Store holding run records.
 * @param workflowStore Registrar for workflow definitions.
 */
export async function inspectRun(
  runId: string,
  store: RunStore,
  workflowStore: WorkflowRegistrar,
): Promise<string> {
  const run: RunRecord = await store.get(runId);

  // Try to load workflow definition; gracefully handle missing definition.
  let workflowLabel: string;
  let definitionMissing = false;
  try {
    const def = await workflowStore.get(run.workflow_id);
    workflowLabel = `${def.id} v${def.version}`;
  } catch {
    workflowLabel = run.workflow_id;
    definitionMissing = true;
  }

  // Color the state label based on terminal outcome.
  let stateLabel: string;
  if (run.terminal_state && run.state === 'completed') {
    stateLabel = chalk.green(`${run.state}  \u2713`);
  } else if (run.terminal_state && (run.state === 'failed' || run.state === 'abandoned')) {
    stateLabel = chalk.red(run.state);
  } else {
    stateLabel = chalk.yellow(run.state);
  }

  const lines: string[] = [];
  lines.push(`Run: ${run.id}`);
  lines.push(`Workflow: ${workflowLabel}`);
  lines.push(`State: ${stateLabel}`);
  lines.push(`Created: ${run.created_at}`);
  lines.push(`Updated: ${run.updated_at}`);

  if (definitionMissing) {
    lines.push('');
    lines.push('(workflow definition not found \u2014 showing run record only)');
  }

  // Group evidence snapshots by step_id, preserving first-appearance order.
  const stepOrder: string[] = [];
  const stepSnapshots = new Map<string, EvidenceSnapshot[]>();
  for (const snap of run.evidence) {
    if (!stepSnapshots.has(snap.step_id)) {
      stepOrder.push(snap.step_id);
      stepSnapshots.set(snap.step_id, []);
    }
    stepSnapshots.get(snap.step_id)!.push(snap);
  }

  lines.push('');
  lines.push(`Evidence (${stepOrder.length} steps):`);

  stepOrder.forEach((stepId, idx) => {
    const snaps = stepSnapshots.get(stepId)!;
    const hasAttempts = snaps.length > 1 && snaps.some((s) => s.attempt !== undefined);
    const totalAttempts = snaps.length;

    lines.push('');

    if (hasAttempts) {
      // Show step name as header, then each attempt as a sub-item.
      lines.push(`  ${idx + 1}. ${stepId}`);
      snaps.forEach((snap, ai) => {
        const statusColored = colorStatus(snap.status);
        const hashShort = chalk.dim(`hash: ${snap.evidence_hash.slice(0, 8)}`);
        lines.push(`     (attempt ${ai + 1}/${totalAttempts})  ${statusColored}   ${snap.duration_ms}ms   ${hashShort}`);
      });
      // Show Input/Output/Diagnostics for the last attempt.
      const lastSnap = snaps[snaps.length - 1]!;
      lines.push(`     Input:  ${JSON.stringify(lastSnap.input_summary)}`);
      lines.push(`     Output: ${JSON.stringify(lastSnap.output_summary)}`);
      if (lastSnap.diagnostics !== undefined) {
        lines.push(chalk.dim(`     Diagnostics: ${formatDiagnostics(lastSnap.diagnostics)}`));
      }
    } else {
      const snap = snaps[0]!;
      const statusColored = colorStatus(snap.status);
      const hashShort = chalk.dim(`hash: ${snap.evidence_hash.slice(0, 8)}`);
      lines.push(`  ${idx + 1}. ${stepId.padEnd(22)} ${statusColored}   ${snap.duration_ms}ms   ${hashShort}`);
      lines.push(`     Input:  ${JSON.stringify(snap.input_summary)}`);
      lines.push(`     Output: ${JSON.stringify(snap.output_summary)}`);
      if (snap.diagnostics !== undefined) {
        lines.push(chalk.dim(`     Diagnostics: ${formatDiagnostics(snap.diagnostics)}`));
      }
    }
  });

  return lines.join('\n');
}

export const inspectCommand = new Command('inspect')
  .argument('<run-id>', 'ID of the run to inspect')
  .description('Display the full evidence chain and diagnostics for a run')
  .action(async (runId: string) => {
    const { JsonFileStore, JsonWorkflowStore } = await import('@sensigo/realm');
    const store = new JsonFileStore();
    const workflowStore = new JsonWorkflowStore();
    try {
      const output = await inspectRun(runId, store, workflowStore);
      console.log(output);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
