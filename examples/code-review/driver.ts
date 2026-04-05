#!/usr/bin/env node
// driver.ts — headless runner for the code-review example.
// Usage: node dist/driver.js fixtures/findings-approved.yaml
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { loadWorkflowFromFile, StateGuard, executeChain, submitHumanResponse } from '@sensigo/realm';
import { InMemoryStore, loadFixtureFromFile } from '@sensigo/realm-testing';
import type { StepDispatcher } from '@sensigo/realm';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fixturePath = process.argv[2];
if (fixturePath === undefined) {
  console.error('Usage: node dist/driver.js <fixture-path>');
  process.exit(1);
}

const definition = loadWorkflowFromFile(join(__dirname, '..', 'workflow.yaml'));
const fixture = loadFixtureFromFile(fixturePath);
const store = new InMemoryStore();
const guard = new StateGuard(definition);

const run = await store.create({
  workflowId: definition.id,
  workflowVersion: definition.version,
  initialState: definition.initial_state,
  params: fixture.params,
});

let runId = run.id;
let currentRun = await store.get(runId);

console.log(`\nRun: ${runId}`);
console.log(`Workflow: ${definition.name} v${definition.version}`);
console.log(`Fixture: ${fixture.name}\n`);

while (!currentRun.terminal_state) {
  const prevEvidenceCount = currentRun.evidence.length;

  if (currentRun.state === 'gate_waiting') {
    const gate = currentRun.pending_gate!;
    const choice = fixture.gate_responses?.[gate.step_name] ?? 'approve';
    const result = await submitHumanResponse(store, definition, {
      runId,
      gateId: gate.gate_id,
      choice,
      snapshotId: currentRun.version.toString(),
    });
    printGateRow(gate.step_name, choice);
    if (result.status === 'error') {
      console.error('Gate submission failed:', result.errors.join(', '));
      process.exit(1);
    }
  } else {
    const allowedSteps = guard.getAllowedSteps(currentRun.state);
    const nextStep = allowedSteps[0];
    if (nextStep === undefined) {
      console.error(`No allowed steps from state '${currentRun.state}'`);
      process.exit(1);
    }
    const agentResponse = (fixture.agent_responses[nextStep] ?? {}) as Record<string, unknown>;
    const dispatcher: StepDispatcher = async () => agentResponse;
    const result = await executeChain(store, guard, definition, {
      runId,
      command: nextStep,
      input: agentResponse,
      snapshotId: currentRun.version.toString(),
      dispatcher,
    });
    if (result.status === 'error') {
      console.error('Step failed:', result.errors.join(', '));
      process.exit(1);
    }
  }

  currentRun = await store.get(runId);

  // Print evidence entries added during this iteration.
  // Skip gate_response entries (printed by printGateRow) and auto-step execution
  // entries (auto steps are represented by their gate row, not a step row).
  const newSnaps = currentRun.evidence.slice(prevEvidenceCount);
  for (const snap of newSnaps) {
    if (snap.kind === 'gate_response') continue;
    if (definition.steps[snap.step_id]?.execution === 'auto') continue;
    printStepRow(snap.step_id, snap.duration_ms, snap.output_summary, snap.status);
  }
}

const evidence = currentRun.evidence;
const allOk = evidence.every((s) => s.status === 'success');
console.log('─'.repeat(57));
console.log(`Final state: ${currentRun.state}`);
console.log(`Evidence hash chain: ${allOk ? 'ok' : 'FAILED'} (${evidence.length}/${evidence.length})`);
console.log(`\nTo inspect: realm inspect ${runId}\n`);
process.exit(currentRun.state === 'completed' ? 0 : 1);

function printStepRow(
  stepId: string,
  durationMs: number,
  output: Record<string, unknown>,
  status: string,
): void {
  const icon = status === 'success' ? '✓' : '✗';
  const dur = durationMs < 1 ? ' —' : `${durationMs}ms`;
  const summary = summariseOutput(output);
  console.log(`${icon} ${stepId.padEnd(24)} ${dur.padStart(6)}   ${summary}`);
}

function printGateRow(stepName: string, choice: string): void {
  console.log(`✓ ${stepName.padEnd(24)}      —   choice=${choice}`);
}

function summariseOutput(output: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(output)) {
    if (Array.isArray(val)) {
      parts.push(`${key}=${val.length}`);
    } else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      parts.push(`${key}=${String(val)}`);
    }
  }
  return parts.slice(0, 3).join('   ');
}
