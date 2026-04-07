// Workflow YAML loader — parses workflow.yaml files into typed WorkflowDefinition objects.
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { load } from 'js-yaml';
import type { WorkflowDefinition } from '../types/workflow-definition.js';
import { WorkflowError } from '../types/workflow-error.js';

const VALID_EXECUTIONS = new Set(['auto', 'agent']);
const VALID_SERVICE_METHODS = new Set(['fetch', 'create', 'update']);

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
  const definition = loadWorkflowFromString(content);

  // Resolve agent profiles — only possible when we have a file path.
  const workflowDir = dirname(resolve(filePath));
  const profilesDir =
    definition.profiles_dir !== undefined
      ? resolve(workflowDir, definition.profiles_dir)
      : join(workflowDir, 'agents');

  const resolvedProfiles: Record<string, { content: string; content_hash: string }> = {};
  const profileErrors: string[] = [];

  for (const [stepName, step] of Object.entries(definition.steps)) {
    if (step.agent_profile === undefined) continue;
    const profileName = step.agent_profile;
    if (profileName in resolvedProfiles) continue; // already resolved (shared across steps)

    const profilePath = join(profilesDir, `${profileName}.md`);
    let profileContent: string;
    try {
      profileContent = readFileSync(profilePath, 'utf8');
    } catch {
      profileErrors.push(
        `Step '${stepName}': agent_profile '${profileName}' not found. Searched: ${profilePath}`,
      );
      continue;
    }

    const contentHash = createHash('sha256').update(profileContent).digest('hex');
    resolvedProfiles[profileName] = { content: profileContent, content_hash: contentHash };
  }

  if (profileErrors.length > 0) {
    throw new WorkflowError(`Invalid workflow: ${profileErrors.join('; ')}`, {
      code: 'VALIDATION_WORKFLOW_SCHEMA',
      category: 'VALIDATION',
      agentAction: 'report_to_user',
      retryable: false,
    });
  }

  if (Object.keys(resolvedProfiles).length > 0) {
    definition.resolved_profiles = resolvedProfiles;
  }

  return definition;
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
      code: 'VALIDATION_WORKFLOW_SCHEMA',
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
      code: 'VALIDATION_WORKFLOW_SCHEMA',
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
    // When a step has on_success, its top-level produces_state is a dead fallback
    // that is never written to the store. Exclude it from reachable states so that
    // target steps do not list it in their allowed_from_states.
    const hasOnSuccess =
      typeof step['transitions'] === 'object' &&
      step['transitions'] !== null &&
      'on_success' in (step['transitions'] as object);
    if (typeof step['produces_state'] === 'string' && !hasOnSuccess) {
      reachableStates.add(step['produces_state']);
    }
    // Transition produces_state values are intermediate states written directly;
    // add them so that target steps listing them in allowed_from_states pass reachability.
    const transitions = step['transitions'];
    if (typeof transitions === 'object' && transitions !== null) {
      for (const [, tRaw] of Object.entries(transitions as Record<string, unknown>)) {
        const t = tRaw as Record<string, unknown>;
        if (typeof t['produces_state'] === 'string') {
          reachableStates.add(t['produces_state']);
        }
        // Handle on_success routes: extract produces_state from each route and default.
        const rawRoutes = t['routes'];
        if (typeof rawRoutes === 'object' && rawRoutes !== null) {
          for (const routeRaw of Object.values(rawRoutes as Record<string, unknown>)) {
            const r = routeRaw as Record<string, unknown>;
            if (typeof r['produces_state'] === 'string') {
              reachableStates.add(r['produces_state']);
            }
          }
        }
        const defaultRoute = t['default'] as Record<string, unknown> | undefined;
        if (typeof defaultRoute?.['produces_state'] === 'string') {
          reachableStates.add(defaultRoute['produces_state']);
        }
      }
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
        `Step '${stepName}': invalid execution value '${String(step['execution'])}'; must be 'auto' or 'agent'`,

      );
    }

    // agent_profile is only valid on agent steps.
    if ('agent_profile' in step && step['execution'] !== 'agent') {
      errors.push(`Step '${stepName}': 'agent_profile' is only valid on execution: agent steps`);
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

    if ('service_method' in step && !VALID_SERVICE_METHODS.has(step['service_method'] as string)) {
      errors.push(
        `Step '${stepName}': invalid service_method '${String(step['service_method'])}'; must be 'fetch', 'create', or 'update'`,
      );
    }

    // Step 5: produces_state uniqueness (skip when on_success is present — the fallback
    // produces_state is never written; route states govern reachability instead).
    const hasOnSuccess =
      typeof step['transitions'] === 'object' &&
      step['transitions'] !== null &&
      'on_success' in (step['transitions'] as object);

    if (typeof step['produces_state'] === 'string' && !hasOnSuccess) {
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

    // Validate transitions.
    const transitions = step['transitions'];
    if (typeof transitions === 'object' && transitions !== null) {
      for (const [transitionKey, tRaw] of Object.entries(transitions as Record<string, unknown>)) {
        if (typeof tRaw !== 'object' || tRaw === null) {
          errors.push(`Step '${stepName}': transition '${transitionKey}' must be an object`);
          continue;
        }
        const t = tRaw as Record<string, unknown>;

        // on_error is only valid on auto steps.
        if (transitionKey === 'on_error') {
          if (step['execution'] !== 'auto') {
            errors.push(`Step '${stepName}': 'on_error' transition is only valid on execution: auto steps`);
          }
        } else if (transitionKey === 'on_success') {
          if (step['execution'] !== 'auto') {
            errors.push(`Step '${stepName}': 'on_success' transition is only valid on execution: auto steps`);
          }
          if (typeof t['field'] !== 'string' || t['field'] === '') {
            errors.push(`Step '${stepName}': 'on_success' transition is missing a non-empty 'field'`);
          }
          const routes = t['routes'];
          if (typeof routes !== 'object' || routes === null || Object.keys(routes as object).length === 0) {
            errors.push(`Step '${stepName}': 'on_success.routes' must be an object with at least one key`);
          }
          if (typeof t['default'] !== 'object' || t['default'] === null) {
            errors.push(`Step '${stepName}': 'on_success' transition is missing a 'default'`);
          }
          const routeEntries: Array<[string, unknown]> = [
            ...Object.entries((routes as Record<string, unknown>) ?? {}),
            ['default', t['default']],
          ];
          for (const [routeKey, routeRaw] of routeEntries) {
            if (typeof routeRaw !== 'object' || routeRaw === null) continue;
            const route = routeRaw as Record<string, unknown>;
            const targetStep = route['step'];
            if (typeof targetStep !== 'string') {
              errors.push(`Step '${stepName}': on_success route '${routeKey}' is missing 'step'`);
            } else if (!(targetStep in stepsRaw)) {
              errors.push(`Step '${stepName}': on_success route '${routeKey}' targets unknown step '${targetStep}'`);
            } else {
              const routeProducesState = route['produces_state'];
              if (typeof routeProducesState === 'string') {
                const targetStepRaw = stepsRaw[targetStep] as Record<string, unknown> | undefined;
                const targetAllowedFrom = targetStepRaw?.['allowed_from_states'];
                if (Array.isArray(targetAllowedFrom) && !(targetAllowedFrom as unknown[]).includes(routeProducesState)) {
                  errors.push(`Step '${stepName}': on_success route '${routeKey}' produces_state '${routeProducesState}' is not in step '${targetStep}'.allowed_from_states`);
                }
              }
            }
          }
          continue; // Skip the flat-map step/produces_state checks below.
        } else {
          // Non-on_error keys must match a gate choice (if gate.choices is declared).
          const gateChoices = (step['gate'] as Record<string, unknown> | undefined)?.['choices'];
          if (Array.isArray(gateChoices)) {
            const choice = transitionKey.startsWith('on_') ? transitionKey.slice(3) : transitionKey;
            if (!(gateChoices as unknown[]).includes(choice)) {
              errors.push(`Step '${stepName}': transition key '${transitionKey}' is not in gate choices [${(gateChoices as string[]).join(', ')}]`);
            }
          }
        }

        // Transition target step must exist.
        const targetStep = t['step'];
        if (typeof targetStep !== 'string') {
          errors.push(`Step '${stepName}': transition '${transitionKey}' is missing 'step' field`);
        } else if (!(targetStep in stepsRaw)) {
          errors.push(`Step '${stepName}': transition '${transitionKey}' targets unknown step '${targetStep}'`);
        } else {
          // produces_state must be in target step's allowed_from_states.
          const transitionProducesState = t['produces_state'];
          if (typeof transitionProducesState === 'string') {
            const targetStepRaw = stepsRaw[targetStep] as Record<string, unknown> | undefined;
            const targetAllowedFrom = targetStepRaw?.['allowed_from_states'];
            if (Array.isArray(targetAllowedFrom) && !(targetAllowedFrom as unknown[]).includes(transitionProducesState)) {
              errors.push(`Step '${stepName}': transition '${transitionKey}' produces_state '${transitionProducesState}' is not in step '${targetStep}'.allowed_from_states`);
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new WorkflowError(`Invalid workflow: ${errors.join('; ')}`, {
      code: 'VALIDATION_WORKFLOW_SCHEMA',
      category: 'VALIDATION',
      agentAction: 'report_to_user',
      retryable: false,
    });
  }

  // Detect ambiguous routing: two steps with the same source state.
  // This would create non-deterministic behaviour in executeChain's step lookup.
  const sourceStateSeen = new Map<string, string>();
  for (const [stepName, stepRaw] of Object.entries(stepsRaw)) {
    const step = stepRaw as Record<string, unknown>;
    if (Array.isArray(step['allowed_from_states'])) {
      for (const state of step['allowed_from_states'] as string[]) {
        const existing = sourceStateSeen.get(state);
        if (existing !== undefined) {
          throw new WorkflowError(
            `Ambiguous routing: steps '${existing}' and '${stepName}' both allow state '${state}'. Each state must route to exactly one step.`,
            {
              code: 'VALIDATION_WORKFLOW_SCHEMA',
              category: 'VALIDATION',
              agentAction: 'report_to_user',
              retryable: false,
            },
          );
        }
        sourceStateSeen.set(state, stepName);
      }
    }
  }

  // Step 6: Return typed result
  return doc as unknown as WorkflowDefinition;
}
