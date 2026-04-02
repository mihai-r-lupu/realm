// Implements the `realm validate <path>` command.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import yaml from 'js-yaml';
import type { WorkflowDefinition, StepDefinition } from '@sensigo/realm';

const VALID_EXECUTIONS = new Set(['auto', 'agent', 'human_gate']);
const REQUIRED_TOP_LEVEL = ['id', 'name', 'version', 'initial_state', 'steps'];
const REQUIRED_STEP_FIELDS: Array<keyof StepDefinition> = [
  'description',
  'execution',
  'allowed_from_states',
  'produces_state',
];

interface ValidationError {
  location: string;
  message: string;
}

export type { ValidationError };

export function validateWorkflow(raw: unknown): { errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push({ location: '(root)', message: 'Workflow must be a YAML object' });
    return { errors };
  }

  const doc = raw as Record<string, unknown>;

  // Required top-level fields
  for (const field of REQUIRED_TOP_LEVEL) {
    if (!(field in doc)) {
      errors.push({ location: '(root)', message: `Missing required field: '${field}'` });
    }
  }

  if (errors.length > 0) return { errors };

  const steps = doc['steps'];
  if (typeof steps !== 'object' || steps === null || Array.isArray(steps)) {
    errors.push({ location: 'steps', message: "'steps' must be a non-empty object" });
    return { errors };
  }

  const stepsMap = steps as Record<string, unknown>;
  const stepNames = Object.keys(stepsMap);
  if (stepNames.length === 0) {
    errors.push({ location: 'steps', message: "'steps' must have at least one step" });
    return { errors };
  }

  const validStates = new Set<string>();
  validStates.add(doc['initial_state'] as string);
  for (const [, stepRaw] of Object.entries(stepsMap)) {
    const step = stepRaw as Record<string, unknown>;
    if (typeof step['produces_state'] === 'string') {
      validStates.add(step['produces_state']);
    }
  }

  // Track produces_state uniqueness
  const seenProducedStates = new Map<string, string>();

  for (const [stepName, stepRaw] of Object.entries(stepsMap)) {
    if (typeof stepRaw !== 'object' || stepRaw === null) {
      errors.push({ location: `steps.${stepName}`, message: 'Step must be an object' });
      continue;
    }
    const step = stepRaw as Record<string, unknown>;

    // Required step fields
    for (const field of REQUIRED_STEP_FIELDS) {
      if (!(field in step)) {
        errors.push({
          location: `steps.${stepName}`,
          message: `Missing required step field: '${String(field)}'`,
        });
      }
    }

    // execution must be valid
    if ('execution' in step && !VALID_EXECUTIONS.has(step['execution'] as string)) {
      errors.push({
        location: `steps.${stepName}.execution`,
        message: `Invalid execution value '${step['execution']}'. Must be one of: auto, agent, human_gate`,
      });
    }

    // allowed_from_states must be a non-empty array of valid states
    if ('allowed_from_states' in step) {
      const afs = step['allowed_from_states'];
      if (!Array.isArray(afs) || afs.length === 0) {
        errors.push({
          location: `steps.${stepName}.allowed_from_states`,
          message: "'allowed_from_states' must be a non-empty array",
        });
      } else {
        for (const state of afs as unknown[]) {
          if (!validStates.has(state as string)) {
            errors.push({
              location: `steps.${stepName}.allowed_from_states`,
              message: `State '${String(state)}' is not a valid state (not initial_state or any produces_state)`,
            });
          }
        }
      }
    }

    // produces_state collision
    if (typeof step['produces_state'] === 'string') {
      const ps = step['produces_state'];
      const prev = seenProducedStates.get(ps);
      if (prev !== undefined) {
        errors.push({
          location: `steps.${stepName}.produces_state`,
          message: `State '${ps}' is already produced by step '${prev}'`,
        });
      } else {
        seenProducedStates.set(ps, stepName);
      }
    }

    // uses_service must exist in services if present
    if ('uses_service' in step && typeof step['uses_service'] === 'string') {
      const services = doc['services'];
      const serviceKey = step['uses_service'];
      if (
        typeof services !== 'object' ||
        services === null ||
        !(serviceKey in (services as Record<string, unknown>))
      ) {
        errors.push({
          location: `steps.${stepName}.uses_service`,
          message: `Service '${serviceKey}' is not defined in 'services'`,
        });
      }
    }
  }

  return { errors };
}

async function resolveWorkflowPath(pathArg: string): Promise<string> {
  if (pathArg.endsWith('.yaml') || pathArg.endsWith('.yml')) {
    return pathArg;
  }
  return join(pathArg, 'workflow.yaml');
}

export const validateCommand = new Command('validate')
  .description('Validate a workflow YAML file')
  .argument('<path>', 'Path to workflow.yaml or directory containing it')
  .action(async (pathArg: string) => {
    const filePath = await resolveWorkflowPath(pathArg);

    if (!existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    let raw: unknown;
    try {
      const content = await readFile(filePath, 'utf8');
      raw = yaml.load(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: Failed to parse YAML: ${msg}`);
      process.exit(1);
    }

    const { errors } = validateWorkflow(raw);

    if (errors.length === 0) {
      const def = raw as WorkflowDefinition;
      const stepCount = Object.keys(def.steps).length;
      console.log(`✓ ${filePath} is valid (${stepCount} steps, version ${def.version})`);
    } else {
      console.error(`✗ ${filePath} has ${errors.length} error(s):`);
      for (const err of errors) {
        console.error(`  [${err.location}] ${err.message}`);
      }
      process.exit(1);
    }
  });
