// Resolves {{ }} template references in step prompts against live run state.
// Syntax: {{ context.resources.STEP_NAME.FIELD }} or {{ run.params.FIELD }}
// Also handles {{ workflow.context.NAME }} and {{ workflow.context.NAME.raw }}.
// Unknown references are left as-is. Object/array values are JSON-stringified.
import type { WorkflowContextSnapshot } from '../types/run-record.js';
import type { ContextWrapperFormat } from '../types/workflow-definition.js';

/**
 * Resolves a dot-path like "context.resources.review_security.findings"
 * against the given root object. Returns undefined if any segment is missing.
 */
export function resolvePath(path: string, root: Record<string, unknown>): unknown {
  const parts = path.trim().split('.');
  let current: unknown = root;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Resolves all {{ ... }} expressions in a template string against the provided context.
 * - Strings: inserted as-is
 * - Objects/arrays: JSON.stringify with 2-space indent
 * - undefined/unresolvable: left as {{ expression }}
 *
 * Handles the workflow.context.* namespace when workflowContext is provided.
 * workflowContext is optional so all existing call sites compile without change.
 */
export function resolvePromptTemplate(
  template: string,
  context: {
    evidenceByStep: Record<string, Record<string, unknown>>;
    runParams: Record<string, unknown>;
    workflowContext?: {
      snapshots: Record<string, WorkflowContextSnapshot>;
      wrapper: ContextWrapperFormat;
    };
  },
): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, path: string) => {
    // Workflow context namespace — handled before the generic path resolver.
    if (path.startsWith('workflow.context.') && context.workflowContext) {
      return resolveWorkflowContextRef(path, context.workflowContext) ?? `{{ ${path} }}`;
    }

    // Existing logic: context.resources.* and run.params.*
    const root: Record<string, unknown> = {
      context: { resources: context.evidenceByStep },
      run: { params: context.runParams },
    };
    const value = resolvePath(path, root);
    if (value === undefined) return `{{ ${path} }}`;
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  });
}

function resolveWorkflowContextRef(
  path: string,
  ctx: { snapshots: Record<string, WorkflowContextSnapshot>; wrapper: ContextWrapperFormat },
): string | undefined {
  // path format: "workflow.context.NAME" or "workflow.context.NAME.raw"
  const segments = path.split('.');
  if (segments.length < 3) return undefined;

  const isRaw = segments[segments.length - 1] === 'raw';
  // Name is everything between "workflow.context." and the optional ".raw"
  const name = isRaw ? segments.slice(2, -1).join('.') : segments.slice(2).join('.');

  const snapshot = ctx.snapshots[name];
  if (!snapshot || snapshot.error !== undefined) return undefined;

  return isRaw ? snapshot.content : wrapContent(name, snapshot.content, ctx.wrapper);
}

function wrapContent(name: string, content: string, wrapper: ContextWrapperFormat): string {
  switch (wrapper) {
    case 'xml':
      return `<${name}>\n${content}\n</${name}>`;
    case 'brackets':
      return `[${name}]\n${content}\n[/${name}]`;
    case 'none':
      return content;
  }
}

