// Template resolver — expands use_template steps into concrete steps before validation.

import type { TemplateDefinition, StepDefinition } from '../types/workflow-definition.js';
import { WorkflowError } from '../types/workflow-error.js';

/**
 * Resolves {{ key }} placeholders in a string value.
 * Unknown placeholders are left as-is (forward compat for nested templates in future).
 */
export function resolvePlaceholders(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{\s*([\w]+)\s*\}\}/g, (match, key: string) => {
    return key in vars ? vars[key]! : match;
  });
}

/**
 * Recursively walks an object and applies resolvePlaceholders to all string leaf values.
 * Does not modify keys — only values.
 */
export function resolveObject(obj: unknown, vars: Record<string, string>): unknown {
  if (typeof obj === 'string') return resolvePlaceholders(obj, vars);
  if (Array.isArray(obj)) return obj.map((item) => resolveObject(item, vars));
  if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, resolveObject(v, vars)]),
    );
  }
  return obj;
}

/**
 * Expands a single use_template instantiation into concrete named steps.
 * Returns an array of [stepId, stepDef] pairs in template declaration order.
 */
export function expandTemplateInstantiation(
  callSiteKey: string,
  instantiation: Record<string, unknown>,
  templates: Record<string, TemplateDefinition>,
): Array<[string, StepDefinition]> {
  const templateName = instantiation['use_template'] as string;
  const template = templates[templateName];
  if (template === undefined) {
    throw new WorkflowError(
      `Step '${callSiteKey}': use_template references unknown template '${templateName}'`,
      {
        code: 'VALIDATION_WORKFLOW_SCHEMA',
        category: 'VALIDATION',
        agentAction: 'report_to_user',
        retryable: false,
      },
    );
  }

  const prefix = instantiation['prefix'];
  if (typeof prefix !== 'string' || prefix === '') {
    throw new WorkflowError(`Step '${callSiteKey}': use_template requires a non-empty 'prefix'`, {
      code: 'VALIDATION_WORKFLOW_SCHEMA',
      category: 'VALIDATION',
      agentAction: 'report_to_user',
      retryable: false,
    });
  }

  // Resolve params: merge caller-supplied values with template defaults.
  const callerParams = (instantiation['params'] ?? {}) as Record<string, unknown>;
  const vars: Record<string, string> = { prefix };
  const paramErrors: string[] = [];

  for (const [paramName, paramDef] of Object.entries(template.params ?? {})) {
    const supplied = callerParams[paramName];
    if (supplied !== undefined) {
      vars[paramName] = String(supplied);
    } else if (paramDef.default !== undefined) {
      vars[paramName] = paramDef.default;
    } else if (paramDef.required === true) {
      paramErrors.push(
        `Step '${callSiteKey}': template '${templateName}' requires param '${paramName}'`,
      );
    }
  }

  if (paramErrors.length > 0) {
    throw new WorkflowError(`Invalid workflow: ${paramErrors.join('; ')}`, {
      code: 'VALIDATION_WORKFLOW_SCHEMA',
      category: 'VALIDATION',
      agentAction: 'report_to_user',
      retryable: false,
    });
  }

  // Expand template steps: prefix_templateStepName → resolved StepDefinition.
  return Object.entries(template.steps).map(([templateStepName, templateStep]) => {
    const stepId = `${prefix}_${templateStepName}`;
    const resolved = resolveObject(templateStep, vars) as StepDefinition;
    return [stepId, resolved];
  });
}

/**
 * Walks the raw steps object and replaces any use_template entries with their
 * expanded concrete steps. Returns a new steps Record in the same order, with
 * template instantiations expanded inline at the position of the call site key.
 *
 * Called by loadWorkflowFromString before per-step validation.
 */
export function resolveTemplates(
  rawSteps: Record<string, unknown>,
  templates: Record<string, TemplateDefinition>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawSteps)) {
    const stepRaw = value as Record<string, unknown>;
    if ('use_template' in stepRaw) {
      const expanded = expandTemplateInstantiation(key, stepRaw, templates);
      for (const [expandedId, expandedStep] of expanded) {
        if (expandedId in resolved) {
          throw new WorkflowError(`Template expansion produced duplicate step ID '${expandedId}'`, {
            code: 'VALIDATION_WORKFLOW_SCHEMA',
            category: 'VALIDATION',
            agentAction: 'report_to_user',
            retryable: false,
          });
        }
        resolved[expandedId] = expandedStep;
      }
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
