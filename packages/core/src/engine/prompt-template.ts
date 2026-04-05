// Resolves {{ }} template references in step prompts against live run state.
// Syntax: {{ context.resources.STEP_NAME.FIELD }} or {{ run.params.FIELD }}
// Unknown references are left as-is. Object/array values are JSON-stringified.

/**
 * Resolves a dot-path like "context.resources.review_security.findings"
 * against the given root object. Returns undefined if any segment is missing.
 */
function resolvePath(path: string, root: Record<string, unknown>): unknown {
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
 */
export function resolvePromptTemplate(
  template: string,
  context: {
    evidenceByStep: Record<string, Record<string, unknown>>;
    runParams: Record<string, unknown>;
  },
): string {
  const root: Record<string, unknown> = {
    context: { resources: context.evidenceByStep },
    run: { params: context.runParams },
  };
  return template.replace(/\{\{\s*([\w.\-]+)\s*\}\}/g, (_match, path: string) => {
    const value = resolvePath(path, root);
    if (value === undefined) return `{{ ${path} }}`;
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  });
}
