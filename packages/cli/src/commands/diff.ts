// diff command — compares the evidence chains of two runs side by side.
import chalk from 'chalk';
import { Command } from 'commander';
import type { RunRecord, EvidenceSnapshot } from '@sensigo/realm';

export interface DiffStepRow {
  step_id: string;
  status_a: string;
  status_b: string;
  hash_a: string;
  hash_b: string;
  duration_a_ms: number;
  duration_b_ms: number;
  /** True when both runs have the step and produce the same evidence hash. */
  same_output: boolean;
  /** True when both runs have the same step status (including 'missing'). */
  same_status: boolean;
}

/**
 * Compares evidence chains of two runs, producing a row per unique step.
 * @param runA First run to compare.
 * @param runB Second run to compare.
 */
export function diffRuns(runA: RunRecord, runB: RunRecord): DiffStepRow[] {
  // Build last non-gate_response snapshot per step_id for each run.
  const lastA = new Map<string, EvidenceSnapshot>();
  const lastB = new Map<string, EvidenceSnapshot>();

  for (const snap of runA.evidence) {
    if (snap.kind === 'gate_response') continue;
    lastA.set(snap.step_id, snap);
  }
  for (const snap of runB.evidence) {
    if (snap.kind === 'gate_response') continue;
    lastB.set(snap.step_id, snap);
  }

  // Collect all unique step IDs, preserving appearance order from A then B.
  const allSteps = new Set<string>();
  for (const id of lastA.keys()) allSteps.add(id);
  for (const id of lastB.keys()) allSteps.add(id);

  return Array.from(allSteps).map((stepId) => {
    const snapA = lastA.get(stepId);
    const snapB = lastB.get(stepId);
    const statusA = snapA?.status ?? 'missing';
    const statusB = snapB?.status ?? 'missing';
    return {
      step_id: stepId,
      status_a: statusA,
      status_b: statusB,
      hash_a: snapA?.evidence_hash ?? '\u2014',
      hash_b: snapB?.evidence_hash ?? '\u2014',
      duration_a_ms: snapA?.duration_ms ?? 0,
      duration_b_ms: snapB?.duration_ms ?? 0,
      same_output:
        snapA !== undefined && snapB !== undefined && snapA.evidence_hash === snapB.evidence_hash,
      same_status: statusA === statusB,
    };
  });
}

/** Applies chalk coloring to a status value in a diff row. */
function colorDiffStatus(status: string): string {
  if (status === 'error' || status === 'missing') return chalk.red(status);
  return status;
}

/** Returns the comparison symbol between A and B columns. */
function diffSymbol(row: DiffStepRow): string {
  if (row.status_a === 'missing' || row.status_b === 'missing') return ' ';
  if (row.same_output && row.same_status) return '=';
  return chalk.yellow('\u2260');
}

/** Formats Δ ms: signed difference if both steps exist, em-dash otherwise. */
function formatDelta(row: DiffStepRow): string {
  if (row.status_a === 'missing' || row.status_b === 'missing') return '\u2014';
  const delta = row.duration_b_ms - row.duration_a_ms;
  if (delta === 0) return '0';
  return delta > 0 ? `+${delta}` : String(delta);
}

export const diffCommand = new Command('diff')
  .argument('<run-id-a>', 'First run ID')
  .argument('<run-id-b>', 'Second run ID')
  .description('Compare evidence chains of two runs side by side')
  .action(async (runIdA: string, runIdB: string) => {
    const { JsonFileStore } = await import('@sensigo/realm');
    const store = new JsonFileStore();

    let runA: RunRecord;
    let runB: RunRecord;
    try {
      runA = await store.get(runIdA);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    try {
      runB = await store.get(runIdB);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (runA.workflow_id !== runB.workflow_id) {
      console.warn(
        `Warning: runs are from different workflows (${runA.workflow_id} vs ${runB.workflow_id})`,
      );
    }

    const rows = diffRuns(runA, runB);

    console.log(`Diff: ${runIdA}  vs  ${runIdB}`);
    console.log(`Workflow: ${runA.workflow_id}`);
    console.log('');

    const col1 = 22;
    const col2 = 10;
    const col3 = 10;
    const sep1 = '\u2500'.repeat(col1 - 1);
    const sep2 = '\u2500'.repeat(col2 - 1);
    const sep3 = '\u2500'.repeat(col3 - 1);

    console.log(
      `${'Step'.padEnd(col1)} ${'A status'.padEnd(col2 + 2)} ${'B status'.padEnd(col2)} ${'A hash'.padEnd(col2)} ${'B hash'.padEnd(col2)} ${'\u0394 ms'}`,
    );
    console.log(`${sep1}  ${sep2}  ${sep2}  ${sep2}  ${sep2}  ${sep3}`);

    for (const row of rows) {
      const sym = diffSymbol(row);
      const statusA = colorDiffStatus(row.status_a).padEnd(col2);
      const statusB = colorDiffStatus(row.status_b).padEnd(col2);
      const hashA = row.hash_a.slice(0, 8).padEnd(col2);
      const hashB = row.hash_b.slice(0, 8).padEnd(col2);
      const delta = formatDelta(row);
      console.log(
        `${row.step_id.padEnd(col1)} ${statusA} ${sym} ${statusB} ${hashA} ${hashB} ${delta}`,
      );
    }
  });
