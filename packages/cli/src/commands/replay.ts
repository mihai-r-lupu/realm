// replay command — re-evaluates preconditions with modified step outputs (read-only simulation).
import { Command } from 'commander';
import type { RunRecord, WorkflowDefinition } from '@sensigo/realm';
import { checkPreconditions } from '@sensigo/realm';

export interface ReplayOverride {
  step: string;
  field: string;
  value: unknown;
}

export interface ReplayStepResult {
  step_id: string;
  /** All preconditions passed in the original run? */
  preconditions_original: boolean;
  /** All preconditions pass with overridden evidence? */
  preconditions_replay: boolean;
  changed: boolean;
}

/** Parses a literal string into a typed value (number, boolean, or string). */
function parseLiteralValue(raw: string): unknown {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  const n = Number(t);
  if (!Number.isNaN(n) && t !== '') return n;
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Sets a value at a dot-separated path within an object, creating
 * intermediate objects as needed.
 */
function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

/**
 * Parses a --with override expression of the form "step.field=value".
 * @throws Error if the expression is missing '.' or '='.
 */
export function parseOverride(expr: string): ReplayOverride {
  const eqIdx = expr.indexOf('=');
  if (eqIdx === -1) throw new Error(`Invalid override '${expr}': missing '='`);
  const left = expr.slice(0, eqIdx);
  const right = expr.slice(eqIdx + 1);
  const dotIdx = left.indexOf('.');
  if (dotIdx === -1) throw new Error(`Invalid override '${expr}': missing '.'`);
  const step = left.slice(0, dotIdx);
  const field = left.slice(dotIdx + 1);
  const value = parseLiteralValue(right);
  return { step, field, value };
}

/**
 * Re-evaluates workflow preconditions with modified step outputs (read-only).
 * Returns a result for each step in definition order.
 * @param run        The run whose evidence to replay.
 * @param definition The workflow definition providing step order and preconditions.
 * @param overrides  Output field overrides to inject before re-evaluation.
 */
export function replayRun(
  run: RunRecord,
  definition: WorkflowDefinition,
  overrides: ReplayOverride[],
): ReplayStepResult[] {
  // Build evidence map from run (last non-gate_response snapshot per step_id).
  const evidenceByStep: Record<string, Record<string, unknown>> = {};
  for (const snap of run.evidence) {
    if (snap.kind === 'gate_response') continue;
    evidenceByStep[snap.step_id] = snap.output_summary;
  }

  // Build replay evidence as a deep clone, then apply overrides.
  // structuredClone prevents nested object mutations from affecting the original evidence map.
  const replayEvidenceByStep: Record<string, Record<string, unknown>> = {};
  for (const [stepId, output] of Object.entries(evidenceByStep)) {
    replayEvidenceByStep[stepId] = structuredClone(output) as Record<string, unknown>;
  }
  for (const override of overrides) {
    if (replayEvidenceByStep[override.step] === undefined) {
      replayEvidenceByStep[override.step] = {};
    }
    deepSet(replayEvidenceByStep[override.step]!, override.field, override.value);
  }

  // Evaluate preconditions for each step in definition order.
  return Object.entries(definition.steps).map(([stepId, step]) => {
    const preconditions = step.preconditions ?? [];
    const originalPass = checkPreconditions(preconditions, evidenceByStep) === null;
    const replayPass = checkPreconditions(preconditions, replayEvidenceByStep) === null;
    return {
      step_id: stepId,
      preconditions_original: originalPass,
      preconditions_replay: replayPass,
      changed: originalPass !== replayPass,
    };
  });
}

/** Formats a precondition comparison column for the replay output table. */
function formatPrecondColumn(originalPass: boolean, replayPass: boolean, hasPreconditions: boolean): string {
  if (!hasPreconditions) return 'none';
  const orig = originalPass ? 'PASS' : 'BLOCKED';
  const replay = replayPass ? 'PASS' : 'BLOCKED';
  return `${orig} \u2192 ${replay}`;
}

export const replayCommand = new Command('replay')
  .argument('<run-id>', 'ID of the completed run to replay')
  .option('--with <override...>', 'Override a step output field: step.field=value')
  .description('Re-evaluate preconditions with modified step outputs (read-only)')
  .action(async (runId: string, opts: { with?: string[] }) => {
    const { JsonFileStore, JsonWorkflowStore } = await import('@sensigo/realm');
    const runStore = new JsonFileStore();
    const workflowStore = new JsonWorkflowStore();

    let run;
    try {
      run = await runStore.get(runId);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (!run.terminal_state) {
      console.warn(`Warning: run ${runId} is not in a terminal state. Partial replay.`);
    }

    let definition;
    try {
      definition = await workflowStore.get(run.workflow_id);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const withExprs: string[] = opts['with'] ?? [];
    const overrides: ReplayOverride[] = [];
    for (const expr of withExprs) {
      try {
        overrides.push(parseOverride(expr));
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }

    const results = replayRun(run, definition, overrides);

    console.log(`Replay of ${runId}`);
    for (const override of overrides) {
      console.log(`Override: ${override.step}.${override.field} = ${String(override.value)}`);
    }
    console.log('');

    const col1 = 22;
    const col2 = 38;
    const header = `${'Step'.padEnd(col1)} ${'Preconditions (original \u2192 replay)'.padEnd(col2)} Changed?`;
    const sep = `${'\u2500'.repeat(col1 - 1)}  ${'\u2500'.repeat(col2 - 1)}  ${'\u2500'.repeat(8)}`;
    console.log(header);
    console.log(sep);

    for (const row of results) {
      const step = definition.steps[row.step_id];
      const hasPreconditions = (step?.preconditions ?? []).length > 0;
      const precondCol = formatPrecondColumn(row.preconditions_original, row.preconditions_replay, hasPreconditions);
      const changedCol = row.changed ? 'YES \u26A0' : 'no';
      console.log(`${row.step_id.padEnd(col1)} ${precondCol.padEnd(col2)} ${changedCol}`);
    }
  });
