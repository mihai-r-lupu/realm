// Fixture loader — reads and parses YAML test fixture files.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { ServiceResponse } from '@sensigo/realm';

/** Mock adapter responses keyed by operation name. */
export interface MockOperations {
  [operation: string]: ServiceResponse;
}

/** A single test scenario loaded from a fixture YAML file. */
export interface TestFixture {
  /** Human-readable fixture name, used in test output. */
  name: string;
  /** Params passed to start_run. */
  params: Record<string, unknown>;
  /**
   * Mock adapter responses keyed by service name, then operation name.
   * Example: { google_docs: { fetch_document: { status: 200, data: { text: '...' } } } }
   */
  mocks: Record<string, MockOperations>;
  /**
   * Pre-built agent responses keyed by step ID.
   * Used by the dispatcher for steps with execution: agent.
   */
  agent_responses: Record<string, Record<string, unknown>>;
  /**
   * Ordered list of error messages to inject for an agent step before its real response is
   * returned. The dispatcher returns each message as a WorkflowError in order, one per call.
   * Once all errors are exhausted the step receives its normal `agent_responses` entry.
   *
   * The test runner automatically resets the run state after each injected error (simulating
   * what `realm run resume --from <step>` does interactively), then retries the step.
   *
   * Example:
   *   agent_errors:
   *     tag_content:
   *       - "provider timed out after 30s"
   */
  agent_errors?: Record<string, string[]>;
  /**
   * Gate choices keyed by step name. Defaults to 'approve' for any step not listed.
   */
  gate_responses?: Record<string, string>;
  expected: {
    /** Expected state of the run after driving it to completion. */
    final_state: string;
    /**
     * Optional list of expected evidence entries. Each entry must match a snapshot
     * in the run's evidence chain (by step_id and optionally status).
     */
    evidence?: Array<{ step_id: string; status?: 'success' | 'error' | 'skipped' }>;
  };
}

/**
 * Loads a TestFixture from a YAML file on disk.
 * @throws Error on read failure or missing required fields.
 */
export function loadFixtureFromFile(filePath: string): TestFixture {
  const content = readFileSync(filePath, 'utf8');
  return loadFixtureFromString(content);
}

/**
 * Parses a YAML string into a TestFixture.
 * @throws Error if required fields (name, expected.final_state) are missing.
 */
export function loadFixtureFromString(content: string): TestFixture {
  const parsed = load(content) as Record<string, unknown>;

  if (typeof parsed['name'] !== 'string' || parsed['name'].trim() === '') {
    throw new Error('Fixture must have a non-empty string "name" field');
  }

  const expected = parsed['expected'] as Record<string, unknown> | undefined;
  if (expected === undefined || typeof expected['final_state'] !== 'string') {
    throw new Error('Fixture must have an "expected.final_state" string field');
  }

  let expectedObj: TestFixture['expected'];
  if (expected['evidence'] !== undefined) {
    expectedObj = {
      final_state: expected['final_state'],
      evidence: expected['evidence'] as Array<{
        step_id: string;
        status?: 'success' | 'error' | 'skipped';
      }>,
    };
  } else {
    expectedObj = { final_state: expected['final_state'] };
  }

  const base: TestFixture = {
    name: parsed['name'],
    params: (parsed['params'] as Record<string, unknown>) ?? {},
    mocks: (parsed['mocks'] as Record<string, MockOperations>) ?? {},
    agent_responses: (parsed['agent_responses'] as Record<string, Record<string, unknown>>) ?? {},
    expected: expectedObj,
  };

  if (parsed['agent_errors'] !== undefined) {
    base.agent_errors = parsed['agent_errors'] as Record<string, string[]>;
  }
  if (parsed['gate_responses'] !== undefined) {
    return { ...base, gate_responses: parsed['gate_responses'] as Record<string, string> };
  }
  return base;
}

/**
 * Loads all *.yaml files from dirPath and returns them as TestFixture[].
 * @throws Error if dirPath does not exist.
 */
export function loadFixturesFromDir(dirPath: string): TestFixture[] {
  if (!existsSync(dirPath)) {
    throw new Error(`Fixture directory does not exist: ${dirPath}`);
  }
  const files = readdirSync(dirPath).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  return files.map((f) => loadFixtureFromFile(join(dirPath, f)));
}
