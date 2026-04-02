// realm run <path> — interactive workflow runner (development driver).
import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import {
  loadWorkflowFromFile,
  JsonFileStore,
  StateGuard,
  executeStep,
} from '@sensigo/realm';
import type { WorkflowDefinition, StepDefinition } from '@sensigo/realm';
import type { StepDispatcher } from '@sensigo/realm';

export const runCommand = new Command('run')
  .argument('<path>', 'Path to workflow directory or workflow.yaml file')
  .option('--params <json>', 'Initial run parameters as JSON string', '{}')
  .description('Run a workflow interactively (development mode)')
  .action(async (inputPath: string, options: { params: string }) => {
    const filePath =
      inputPath.endsWith('.yaml') || inputPath.endsWith('.yml')
        ? inputPath
        : join(inputPath, 'workflow.yaml');

    // 1. Load workflow
    let definition: WorkflowDefinition;
    try {
      definition = loadWorkflowFromFile(filePath);
    } catch (err) {
      console.error(
        `Error loading workflow: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    // 2. Parse params
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(options.params) as Record<string, unknown>;
    } catch {
      console.error('Error: --params is not valid JSON');
      process.exit(1);
    }

    // 3. Create store, state guard, and initial run record
    const store = new JsonFileStore();
    const guard = new StateGuard(definition);

    const initialRecord = await store.create({
      workflowId: definition.id,
      workflowVersion: definition.version,
      initialState: definition.initial_state,
      params,
    });
    const runId = initialRecord.id;

    console.log(`\nRealm — ${definition.name} v${definition.version}`);
    console.log(`Run ID: ${runId}`);
    console.log(`Initial state: ${definition.initial_state}\n`);

    // 4. Set up readline
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    // 5. Execution loop
    let run = await store.get(runId);

    try {
      while (!run.terminal_state) {
        const allowedSteps = guard.getAllowedSteps(run.state);

        if (allowedSteps.length === 0) {
          console.error(`\nNo steps available from state '${run.state}'. Workflow stalled.`);
          break;
        }

        // Take the first allowed step (linear workflow for Phase 1a)
        const stepName = allowedSteps[0]!;
        const stepDef: StepDefinition = definition.steps[stepName]!;

        console.log(`→ [${stepDef.execution}] ${stepName}: ${stepDef.description}`);

        // Build dispatcher output based on execution type
        let userOutput: Record<string, unknown>;

        if (stepDef.execution === 'human_gate') {
          const answer = await rl.question('  Approve? [y/N]: ');
          userOutput = { approved: answer.toLowerCase() === 'y' };
        } else if (stepDef.execution === 'agent') {
          const raw = await rl.question('  Agent output JSON (Enter for {}): ');
          userOutput = raw.trim() === '' ? {} : (JSON.parse(raw) as Record<string, unknown>);
        } else {
          // auto step
          const hint =
            stepDef.handler !== undefined
              ? `handler: ${stepDef.handler}`
              : stepDef.uses_service !== undefined
                ? `service: ${stepDef.uses_service}`
                : 'auto';
          const raw = await rl.question(`  Mock output (${hint}) — JSON (Enter for {}): `);
          userOutput = raw.trim() === '' ? {} : (JSON.parse(raw) as Record<string, unknown>);
        }

        const dispatcher: StepDispatcher = async () => userOutput;

        const result = await executeStep(store, guard, definition, {
          runId,
          command: stepName,
          input: params,
          snapshotId: run.version.toString(),
          dispatcher,
        });

        if (result.status === 'ok') {
          run = await store.get(runId);
          const ev = result.evidence[0];
          const hash = ev !== undefined ? ev.evidence_hash.slice(0, 8) : 'n/a';
          const dur = ev !== undefined ? `${ev.duration_ms}ms` : 'n/a';
          console.log(`  ✓ → ${run.state} | hash: ${hash}... | ${dur}\n`);
        } else {
          console.error(`  ✗ ${result.status}: ${result.errors.join(', ')}\n`);
          if (result.status === 'error') break;
          // For blocked, reload and continue
          run = await store.get(runId);
        }
      }

      if (run.terminal_state) {
        console.log(`Run complete. Final state: ${run.state}`);
      }
    } finally {
      rl.close();
    }
  });
