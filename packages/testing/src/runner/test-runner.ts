// Test runner — drives a workflow to completion per fixture and reports results.
import {
  loadWorkflowFromFile,
  StateGuard,
  ExtensionRegistry,
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

    // Build per-fixture registry: register mock adapters by adapter id.
    const fixtureRegistry = new ExtensionRegistry();
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
      const envelope = await executeChain(store, guard, definition, {
        runId,
        command: nextStep,
        input: {},
        snapshotId: currentRun.version.toString(),
        dispatcher,
      });

      if (envelope.status === 'error') {
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
