// Test runner — drives a workflow to completion per fixture and reports results.
import {
  loadWorkflowFromFile,
  StateGuard,
  ExtensionRegistry,
  createDefaultRegistry,
  executeChain,
  type WorkflowDefinition,
} from '@sensigo/realm';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { InMemoryStore } from '../store/in-memory-store.js';
import { loadFixturesFromDir, type TestFixture } from '../fixtures/fixture-loader.js';
import { MockServiceRecorder } from '../mocks/mock-service.js';
import { createAgentDispatcher } from '../mocks/mock-agent.js';
import { createGateResponder } from '../mocks/mock-gate.js';
import { assertFinalState } from '../assertions/evidence.js';

/** Result of a single fixture test run. */
export interface TestResult {
  /** Fixture name. */
  name: string;
  passed: boolean;
  /** Error message if passed === false. */
  error?: string;
}

/** Options for runFixtureTests. */
export interface RunFixtureTestsOptions {
  /** Path to workflow.yaml or to the directory containing workflow.yaml. */
  workflowPath: string;
  /** Path to a directory containing *.yaml fixture files. */
  fixturesPath: string;
  /**
   * Optional ExtensionRegistry. If provided, handlers and adapters registered
   * here are available as a fallback in the dispatcher. If omitted, a new empty
   * registry is created per fixture run.
   */
  registry?: ExtensionRegistry;
}

async function runSingleFixture(
  fixture: TestFixture,
  definition: WorkflowDefinition,
  guard: StateGuard,
  options: RunFixtureTestsOptions,
): Promise<TestResult> {
  try {
    const store = new InMemoryStore();

    // Build per-fixture registry: start from built-in adapters, then overlay
    // mock adapters so fixture mocks take precedence over the real ones.
    const fixtureRegistry = createDefaultRegistry();
    for (const [serviceName, mockOps] of Object.entries(fixture.mocks)) {
      const serviceDef = definition.services?.[serviceName];
      if (serviceDef !== undefined) {
        const recorder = new MockServiceRecorder(serviceDef.adapter, mockOps);
        fixtureRegistry.register('adapter', serviceDef.adapter, recorder);
      }
    }

    const dispatcher = createAgentDispatcher(
      definition,
      fixtureRegistry,
      fixture.agent_responses,
      options.registry,
      fixture.agent_errors,
    );

    const run = await store.create({
      workflowId: definition.id,
      workflowVersion: definition.version,
      initialState: definition.initial_state,
      params: fixture.params,
    });
    const runId = run.id;

    const maxIterations = Object.keys(definition.steps).length * 2 + 10;
    let iterations = 0;
    let currentRun = run;
    // Tracks how many times each step has been resumed after a mock error.
    const stepResumeCount: Record<string, number> = {};

    while (!currentRun.terminal_state) {
      if (iterations++ >= maxIterations) {
        return {
          name: fixture.name,
          passed: false,
          error: 'Workflow stalled: exceeded maximum loop iterations',
        };
      }

      const allowedSteps = guard.getAllowedSteps(currentRun.state);
      if (allowedSteps.length === 0) {
        return {
          name: fixture.name,
          passed: false,
          error: `Workflow stalled: no steps allowed from state '${currentRun.state}'`,
        };
      }

      const nextStep = allowedSteps[0]!;
      const stepDef = definition.steps[nextStep];
      // Agent steps need the fixture's pre-built response as the input so the
      // engine's input_schema validation passes before the dispatcher runs.
      // Auto steps take no caller-provided input — the engine resolves it via
      // input_map or the adapter/handler call.
      const stepInput =
        stepDef?.execution === 'agent'
          ? ((fixture.agent_responses[nextStep] ?? {}) as Record<string, unknown>)
          : {};
      const envelope = await executeChain(store, guard, definition, {
        runId,
        command: nextStep,
        input: stepInput,
        snapshotId: currentRun.version.toString(),
        dispatcher,
        registry: fixtureRegistry,
      });

      if (envelope.status === 'error') {
        // If this step has mock errors configured and we haven't exhausted them yet,
        // simulate `realm run resume --from <step>`: reset the run to the step's
        // allowed_from_state and continue the loop instead of failing the test.
        const mockErrors = fixture.agent_errors?.[nextStep];
        const resumesDone = stepResumeCount[nextStep] ?? 0;
        if (mockErrors !== undefined && resumesDone < mockErrors.length) {
          stepResumeCount[nextStep] = resumesDone + 1;
          const stepDef = definition.steps[nextStep]!;
          const resetState = stepDef.allowed_from_states[0]!;
          const failedRun = await store.get(runId);
          const { terminal_reason: _tr, ...rest } = failedRun;
          await store.update({ ...rest, state: resetState, terminal_state: false });
          currentRun = await store.get(runId);
          continue;
        }
        return {
          name: fixture.name,
          passed: false,
          error: envelope.errors[0] ?? 'Unknown error from step execution',
        };
      }

      if (envelope.status === 'confirm_required') {
        const gateResult = await createGateResponder(
          store,
          definition,
          runId,
          envelope.snapshot_id,
          fixture.gate_responses ?? {},
        );
        if (gateResult.status === 'error') {
          return {
            name: fixture.name,
            passed: false,
            error: gateResult.errors[0] ?? 'Unknown gate response error',
          };
        }
      }

      currentRun = await store.get(runId);
    }

    // Assert final state.
    assertFinalState(currentRun, fixture.expected.final_state);

    // Assert expected evidence entries if provided.
    if (fixture.expected.evidence !== undefined) {
      for (const expected of fixture.expected.evidence) {
        const snap = currentRun.evidence.find(
          (e) =>
            e.step_id === expected.step_id &&
            e.kind !== 'gate_response' &&
            (expected.status === undefined || e.status === expected.status),
        );
        if (snap === undefined) {
          const statusClause =
            expected.status !== undefined ? ` with status '${expected.status}'` : '';
          throw new Error(
            `Expected evidence for step '${expected.step_id}'${statusClause} not found`,
          );
        }
      }
    }

    return { name: fixture.name, passed: true };
  } catch (err) {
    return {
      name: fixture.name,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Runs all fixture tests for the workflow.
 * Returns TestResult[] (one per fixture).
 */
export async function runFixtureTests(options: RunFixtureTestsOptions): Promise<TestResult[]> {
  const workflowFilePath =
    options.workflowPath.endsWith('.yaml') || options.workflowPath.endsWith('.yml')
      ? options.workflowPath
      : existsSync(join(options.workflowPath, 'workflow.yaml'))
        ? join(options.workflowPath, 'workflow.yaml')
        : options.workflowPath;

  const definition = loadWorkflowFromFile(workflowFilePath);
  const guard = new StateGuard(definition);
  const fixtures = loadFixturesFromDir(options.fixturesPath);

  return Promise.all(
    fixtures.map((fixture) => runSingleFixture(fixture, definition, guard, options)),
  );
}
