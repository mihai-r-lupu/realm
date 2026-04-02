// Workflow YAML loader — parses workflow.yaml files into typed WorkflowDefinition objects.
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { WorkflowDefinition } from '../types/workflow-definition.js';
import { WorkflowError } from '../types/workflow-error.js';

const VALID_EXECUTIONS = new Set(['auto', 'agent', 'human_gate']);

/**
 * Loads a WorkflowDefinition from a YAML file on disk.
 * @throws WorkflowError on read failure or structural validation errors.
 */
export function loadWorkflowFromFile(filePath: string): WorkflowDefinition {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkflowError(`Failed to read workflow file: ${message}`, {
      code: 'RESOURCE_FETCH_FAILED',
      category: 'RESOURCE',
      agentAction: 'report_to_user',
      retryable: false,
    });
  }
  return loadWorkflowFromString(content);
}

/**
 * Loads a WorkflowDefinition from a YAML string.
 * Validates structure, state reachability, and produces_state uniqueness.
 * @throws WorkflowError on parse failure or structural validation errors.
 */
export function loadWorkflowFromString(content: string): WorkflowDefinition {
  // Step 1: Parse YAML
  let raw: unknown;
  try {
    raw = load(content);
  } catch (err) {
    throw new WorkflowError(
      `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
      {
        code: 'RESOURCE_FORMAT_INVALID',
        category: 'RESOURCE',
        agentAction: 'report_to_user',
        retryable: false,
      },
    );
  }

  const errors: string[] = [];

  // Step 2: Top-level validation
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new WorkflowError('Invalid workflow: Workflow must be a non-null object', {
      code: 'VALIDATION_INPUT_SCHEMA',
      category: 'VALIDATION',
      agentAction: 'report_to_user',
      retryable: false,
    });
  }

  const doc = raw as Record<string, unknown>;
  const REQUIRED_TOP_LEVEL = ['id', 'name', 'version', 'initial_state', 'steps'];
  for (const field of REQUIRED_TOP_LEVEL) {
    if (!(field in doc)) {
      errors.push(`Missing required field: '${field}'`);
    }
  }

  if ('version' in doc && typeof doc['version'] !== 'number') {
    errors.push(`'version' must be a number`);
  }
  if ('initial_state' in doc && typeof doc['initial_state'] !== 'string') {
    errors.push(`'initial_state' must be a string`);
  }
  if (
    'steps' in doc &&
    (typeof doc['steps'] !== 'object' || doc['steps'] === null || Array.isArray(doc['steps']))
  ) {
    errors.push(`'steps' must be a non-null object`);
  }

  if (errors.length > 0) {
    throw new WorkflowError(`Invalid workflow: ${errors.join('; ')}`, {
      code: 'VALIDATION_INPUT_SCHEMA',
      category: 'VALIDATION',
      agentAction: 'report_to_user',
      retryable: false,
    });
  }

  const stepsRaw = doc['steps'] as Record<string, unknown>;
  const initialState = doc['initial_state'] as string;

  // Build reachable states set (Step 4 prerequisite)
  const reachableStates = new Set<string>([initialState]);
  for (const [, stepRaw] of Object.entries(stepsRaw)) {
    const step = stepRaw as Record<string, unknown>;
    if (typeof step['produces_state'] === 'string') {
      reachableStates.add(step['produces_state']);
    }
  }

  // Step 3: Per-step validation
  const seenProducedStates = new Map<string, string>();

  for (const [stepName, stepRaw] of Object.entries(stepsRaw)) {
    if (typeof stepRaw !== 'object' || stepRaw === null || Array.isArray(stepRaw)) {
      errors.push(`Step '${stepName}' must be an object`);
      continue;
    }
    const step = stepRaw as Record<string, unknown>;

    const REQUIRED_STEP = ['description', 'execution', 'allowed_from_states', 'produces_state'];
    for (const field of REQUIRED_STEP) {
      if (!(field in step)) {
        errors.push(`Step '${stepName}': missing required field '${field}'`);
      }
    }

    if ('execution' in step && !VALID_EXECUTIONS.has(step['execution'] as string)) {
      errors.push(
        `Step '${stepName}': invalid execution value '${String(step['execution'])}'; must be auto, agent, or human_gate`,
      );
    }

    if ('uses_service' in step && typeof step['uses_service'] === 'string') {
      const services = doc['services'];
      if (
        typeof services !== 'object' ||
        services === null ||
        !(step['uses_service'] in (services as Record<string, unknown>))
      ) {
        errors.push(
          `Step '${stepName}': uses_service '${step['uses_service']}' is not defined in 'services'`,
        );
      }
    }

    // Step 5: produces_state uniqueness
    if (typeof step['produces_state'] === 'string') {
      const ps = step['produces_state'];
      const prev = seenProducedStates.get(ps);
      if (prev !== undefined) {
        errors.push(`produces_state '${ps}' is claimed by both '${prev}' and '${stepName}'`);
      } else {
        seenProducedStates.set(ps, stepName);
      }
    }

    // Step 4: allowed_from_states reachability
    if (Array.isArray(step['allowed_from_states'])) {
      for (const state of step['allowed_from_states'] as unknown[]) {
        if (!reachableStates.has(state as string)) {
          errors.push(
            `Step '${stepName}': allowed_from_state '${String(state)}' is never produced`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new WorkflowError(`Invalid workflow: ${errors.join('; ')}`, {
      code: 'VALIDATION_INPUT_SCHEMA',
      category: 'VALIDATION',
      agentAction: 'report_to_user',
      retryable: false,
    });
  }

  // Step 6: Return typed result
  return doc as unknown as WorkflowDefinition;
}
