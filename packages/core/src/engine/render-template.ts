// Renders {{ }} template expressions against live run state.
// Syntax: {{ path | filter1: arg | filter2 }} or {{ path }}
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

// ─── Filter system ────────────────────────────────────────────────────────────

type FilterResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'unknown_filter'; filterName: string }
  | { ok: false; reason: 'type_mismatch' };

/** Thrown by renderTemplate when strict mode is on and an unknown filter is encountered. */
export class UnknownFilterError extends Error {
  constructor(public readonly filterName: string) {
    super(`Unknown filter: '${filterName}'`);
    this.name = 'UnknownFilterError';
  }
}

/**
 * Applies a single named filter to a value and returns a FilterResult.
 * Exported for direct testing of individual filter behaviour.
 */
export function applyFilter(value: unknown, filterName: string, args: string[]): FilterResult {
  switch (filterName) {
    case 'bullets': {
      if (!Array.isArray(value)) return { ok: false, reason: 'type_mismatch' };
      if (value.length === 0) return { ok: true, value: undefined };
      return { ok: true, value: value.map((item) => `• ${String(item)}`).join('\n') };
    }

    case 'join': {
      if (!Array.isArray(value)) return { ok: false, reason: 'type_mismatch' };
      const sep = args[0] ?? ', ';
      return { ok: true, value: value.map((item) => String(item)).join(sep) };
    }

    case 'default': {
      const fallback = args[0] ?? '';
      if (value === null || value === undefined) return { ok: true, value: fallback };
      return { ok: true, value };
    }

    case 'upper': {
      if (typeof value !== 'string') return { ok: false, reason: 'type_mismatch' };
      return { ok: true, value: value.toUpperCase() };
    }

    case 'truncate': {
      if (typeof value !== 'string') return { ok: false, reason: 'type_mismatch' };
      const rawArg = args[0];
      if (rawArg === undefined) return { ok: false, reason: 'type_mismatch' };
      const limit = parseInt(rawArg, 10);
      if (isNaN(limit)) return { ok: false, reason: 'type_mismatch' };
      if (value.length <= limit) return { ok: true, value };
      // Find last word boundary at or before limit.
      const sub = value.slice(0, limit);
      const boundary = sub.lastIndexOf(' ');
      const cut = boundary > 0 ? sub.slice(0, boundary) : sub;
      return { ok: true, value: `${cut}…` };
    }

    // ─── Tier 2 filters ───────────────────────────────────────────────────

    case 'pluck': {
      if (!Array.isArray(value)) return { ok: false, reason: 'type_mismatch' };
      const key = args[0];
      if (!key) return { ok: false, reason: 'type_mismatch' };
      const result: unknown[] = [];
      for (const item of value) {
        if (typeof item !== 'object' || item === null) continue;
        const record = item as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(record, key)) {
          result.push(record[key]);
        }
      }
      return { ok: true, value: result };
    }

    case 'count': {
      if (!Array.isArray(value)) return { ok: false, reason: 'type_mismatch' };
      return { ok: true, value: String(value.length) };
    }

    case 'limit': {
      if (!Array.isArray(value)) return { ok: false, reason: 'type_mismatch' };
      const rawLimit = args[0];
      if (rawLimit === undefined) return { ok: false, reason: 'type_mismatch' };
      const n = parseInt(rawLimit, 10);
      if (isNaN(n)) return { ok: false, reason: 'type_mismatch' };
      return { ok: true, value: value.slice(0, n) };
    }

    case 'compact': {
      if (!Array.isArray(value)) return { ok: false, reason: 'type_mismatch' };
      return { ok: true, value: value.filter((item) => item !== null && item !== undefined) };
    }

    case 'round': {
      if (typeof value !== 'number') return { ok: false, reason: 'type_mismatch' };
      const rawDecimals = args[0];
      let decimals = 0;
      if (rawDecimals !== undefined && rawDecimals !== '') {
        const parsed = parseInt(rawDecimals, 10);
        if (isNaN(parsed)) return { ok: false, reason: 'type_mismatch' };
        decimals = parsed;
      }
      return { ok: true, value: value.toFixed(decimals) };
    }

    case 'percent': {
      if (typeof value !== 'number') return { ok: false, reason: 'type_mismatch' };
      const rawDecimals = args[0];
      let decimals = 0;
      if (rawDecimals !== undefined && rawDecimals !== '') {
        const parsed = parseInt(rawDecimals, 10);
        if (isNaN(parsed)) return { ok: false, reason: 'type_mismatch' };
        decimals = parsed;
      }
      return { ok: true, value: `${(value * 100).toFixed(decimals)}%` };
    }

    case 'replace': {
      if (typeof value !== 'string') return { ok: false, reason: 'type_mismatch' };
      const search = args[0];
      const replacement = args[1];
      if (search === undefined || replacement === undefined) return { ok: false, reason: 'type_mismatch' };
      if (search === '') return { ok: false, reason: 'type_mismatch' };
      return { ok: true, value: value.replaceAll(search, replacement) };
    }

    case 'yesno': {
      if (typeof value !== 'boolean') return { ok: false, reason: 'type_mismatch' };
      if (args.length >= 2) {
        return { ok: true, value: value ? args[0] : args[1] };
      }
      // zero or one arg: fall back to defaults (preserves Phase 43b promise)
      return { ok: true, value: value ? 'yes' : 'no' };
    }

    case 'and_join': {
      if (!Array.isArray(value)) return { ok: false, reason: 'type_mismatch' };
      if (value.length === 0) return { ok: true, value: undefined };
      const strs = value.map((item) => String(item));
      if (strs.length === 1) return { ok: true, value: strs[0] };
      if (strs.length === 2) return { ok: true, value: `${strs[0]} and ${strs[1]}` };
      const last = strs[strs.length - 1];
      const rest = strs.slice(0, -1);
      return { ok: true, value: `${rest.join(', ')}, and ${last}` };
    }

    default:
      return { ok: false, reason: 'unknown_filter', filterName };
  }
}

// Strip outer matching quotes from a single token.
function stripOuterQuotes(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

// Splits input on every occurrence of delimiter that is not inside a quoted string.
// Single or double quotes both open/close quote state; the other quote type is ignored
// while inside a quote. delimiter must be a single character.
// Returns raw substrings — no trimming, no quote stripping.
function splitOnUnquotedDelimiter(input: string, delimiter: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (const ch of input) {
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; continue; }
    if (ch === delimiter && !inSingle && !inDouble) {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

function splitOnUnquotedPipes(expr: string): string[] {
  return splitOnUnquotedDelimiter(expr, '|');
}

// Parses a comma-separated filter argument list with quote awareness.
// Calls splitOnUnquotedDelimiter, then strips outer quotes and trims each token.
// An empty or whitespace-only raw string returns [].
function parseFilterArgs(raw: string): string[] {
  if (!raw.trim()) return [];
  return splitOnUnquotedDelimiter(raw, ',').map((token) => stripOuterQuotes(token.trim()));
}

// Parse the filter chain from the pipe-separated expression tail.
// Returns an array of { name, args } entries.
function parseFilters(expr: string): Array<{ name: string; args: string[] }> {
  const segments = splitOnUnquotedPipes(expr).slice(1); // first segment is the path
  return segments.map((seg) => {
    const colonIdx = seg.indexOf(':');
    if (colonIdx === -1) {
      return { name: seg.trim(), args: [] };
    }
    const name = seg.slice(0, colonIdx).trim();
    const args = parseFilterArgs(seg.slice(colonIdx + 1));
    return { name, args };
  });
}

// ─── renderTemplate ────────────────────────────────────────────────────────────

/**
 * Renders all {{ ... }} expressions in a template string against the provided context.
 * Supports pipe-filter syntax: {{ path | filter1: arg | filter2 }}
 *
 * - Strings: inserted as-is (after filter chain)
 * - Objects/arrays: JSON.stringify with 2-space indent (no filters)
 * - undefined/unresolvable or type_mismatch: left as {{ expression }}
 * - unknown_filter in strict mode: throws UnknownFilterError
 * - unknown_filter in lenient mode: leaves placeholder intact
 *
 * Handles the workflow.context.* namespace when workflowContext is provided.
 */
export function renderTemplate(
  template: string,
  context: {
    evidenceByStep: Record<string, Record<string, unknown>>;
    runParams: Record<string, unknown>;
    workflowContext?: {
      snapshots: Record<string, WorkflowContextSnapshot>;
      wrapper: ContextWrapperFormat;
    };
  },
  options?: { strict?: boolean },
): string {
  // Matches {{ path }} and {{ path | filter | filter: arg }} — allows any content except }}.
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
    const pipeIdx = expr.indexOf('|');
    const hasFilters = pipeIdx !== -1;

    // Extract just the path (the part before the first pipe, or the whole expr).
    const rawPath = (hasFilters ? expr.slice(0, pipeIdx) : expr).trim();
    const fullExpr = expr.trim();

    // Workflow context namespace — handled before the generic path resolver.
    if (rawPath.startsWith('workflow.context.') && context.workflowContext) {
      if (!hasFilters) {
        return resolveWorkflowContextRef(rawPath, context.workflowContext) ?? `{{ ${fullExpr} }}`;
      }
    }

    // Generic path resolution — context.resources.* and run.params.*
    const root: Record<string, unknown> = {
      context: { resources: context.evidenceByStep },
      run: { params: context.runParams },
    };
    const rawValue = rawPath.startsWith('workflow.context.') && context.workflowContext
      ? resolveWorkflowContextRef(rawPath, context.workflowContext)
      : resolvePath(rawPath, root);

    if (!hasFilters) {
      // Original coercion behaviour.
      if (rawValue === undefined) return `{{ ${fullExpr} }}`;
      if (typeof rawValue === 'string') return rawValue;
      return JSON.stringify(rawValue, null, 2);
    }

    // Filter chain processing.
    const filters = parseFilters(expr);
    let current: unknown = rawValue;

    for (const { name, args } of filters) {
      const result = applyFilter(current, name, args);
      if (!result.ok) {
        if (result.reason === 'unknown_filter') {
          if (options?.strict === true) {
            throw new UnknownFilterError(result.filterName);
          }
          // Lenient: leave placeholder intact.
          return `{{ ${fullExpr} }}`;
        }
        // type_mismatch: always leave placeholder intact.
        return `{{ ${fullExpr} }}`;
      }
      current = result.value;
    }

    // After filter chain — coerce to string.
    if (current === undefined || current === null) return `{{ ${fullExpr} }}`;
    if (typeof current === 'string') return current;
    return JSON.stringify(current, null, 2);
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


