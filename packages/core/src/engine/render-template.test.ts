import { describe, it, expect } from 'vitest';
import { renderTemplate, applyFilter, UnknownFilterError } from './render-template.js';

const evidence = {
  review_security: {
    findings: [{ severity: 'critical', description: 'SQL injection' }],
  },
};
const params = { code: 'const x = 1;', repo: 'acme/app' };

describe('renderTemplate', () => {
  it('resolves run.params reference', () => {
    const result = renderTemplate('Code: {{ run.params.code }}', {
      evidenceByStep: {},
      runParams: params,
    });
    expect(result).toBe('Code: const x = 1;');
  });

  it('resolves context.resources reference to an object (JSON stringified)', () => {
    const result = renderTemplate(
      'Findings: {{ context.resources.review_security.findings }}',
      { evidenceByStep: evidence, runParams: {} },
    );
    expect(result).toContain('SQL injection');
    expect(result).toContain('critical');
  });

  it('leaves unresolvable reference as-is', () => {
    const result = renderTemplate('Missing: {{ run.params.nonexistent }}', {
      evidenceByStep: {},
      runParams: {},
    });
    expect(result).toBe('Missing: {{ run.params.nonexistent }}');
  });

  it('resolves multiple references in one template', () => {
    const result = renderTemplate(
      'Repo: {{ run.params.repo }}\nFindings: {{ context.resources.review_security.findings }}',
      { evidenceByStep: evidence, runParams: params },
    );
    expect(result).toContain('acme/app');
    expect(result).toContain('SQL injection');
  });

  it('returns template unchanged when it has no {{ }} tokens', () => {
    const tmpl = 'Analyze the code for security issues.';
    expect(renderTemplate(tmpl, { evidenceByStep: {}, runParams: {} })).toBe(tmpl);
  });

  it('handles deeply nested paths', () => {
    const deepEvidence = { step_a: { nested: { value: 42 } } };
    const result = renderTemplate('{{ context.resources.step_a.nested }}', {
      evidenceByStep: deepEvidence as unknown as Record<string, Record<string, unknown>>,
      runParams: {},
    });
    expect(result).toContain('42');
  });
});

const contextSnapshot = {
  source_path: '/tmp/guidelines.md',
  content: 'Be concise.',
  content_hash: 'abc123',
  loaded_at: '2026-01-01T00:00:00.000Z',
};

describe('renderTemplate — workflow.context namespace', () => {
  it('{{ workflow.context.NAME }} with wrapper xml wraps in XML tags', () => {
    const result = renderTemplate('{{ workflow.context.guidelines }}', {
      evidenceByStep: {},
      runParams: {},
      workflowContext: {
        snapshots: { guidelines: contextSnapshot },
        wrapper: 'xml',
      },
    });
    expect(result).toBe('<guidelines>\nBe concise.\n</guidelines>');
  });

  it('{{ workflow.context.NAME }} with wrapper brackets wraps in bracket tags', () => {
    const result = renderTemplate('{{ workflow.context.guidelines }}', {
      evidenceByStep: {},
      runParams: {},
      workflowContext: {
        snapshots: { guidelines: contextSnapshot },
        wrapper: 'brackets',
      },
    });
    expect(result).toBe('[guidelines]\nBe concise.\n[/guidelines]');
  });

  it('{{ workflow.context.NAME }} with wrapper none returns raw content', () => {
    const result = renderTemplate('{{ workflow.context.guidelines }}', {
      evidenceByStep: {},
      runParams: {},
      workflowContext: {
        snapshots: { guidelines: contextSnapshot },
        wrapper: 'none',
      },
    });
    expect(result).toBe('Be concise.');
  });

  it('{{ workflow.context.NAME.raw }} returns raw content regardless of wrapper', () => {
    const result = renderTemplate('{{ workflow.context.guidelines.raw }}', {
      evidenceByStep: {},
      runParams: {},
      workflowContext: {
        snapshots: { guidelines: contextSnapshot },
        wrapper: 'xml',
      },
    });
    expect(result).toBe('Be concise.');
  });

  it('{{ workflow.context.NAME }} left as-is when entry is absent from snapshots', () => {
    const result = renderTemplate('{{ workflow.context.missing }}', {
      evidenceByStep: {},
      runParams: {},
      workflowContext: {
        snapshots: {},
        wrapper: 'xml',
      },
    });
    expect(result).toBe('{{ workflow.context.missing }}');
  });

  it('{{ workflow.context.NAME }} left as-is when snapshot has error set', () => {
    const errSnapshot = { ...contextSnapshot, content: '', content_hash: '', error: 'ENOENT' };
    const result = renderTemplate('{{ workflow.context.guidelines }}', {
      evidenceByStep: {},
      runParams: {},
      workflowContext: {
        snapshots: { guidelines: errSnapshot },
        wrapper: 'xml',
      },
    });
    expect(result).toBe('{{ workflow.context.guidelines }}');
  });

  it('{{ workflow.context.NAME }} left as-is when workflowContext is undefined', () => {
    const result = renderTemplate('{{ workflow.context.guidelines }}', {
      evidenceByStep: {},
      runParams: {},
    });
    expect(result).toBe('{{ workflow.context.guidelines }}');
  });

  it('existing {{ context.resources.* }} and {{ run.params.* }} continue to work alongside workflow.context', () => {
    const result = renderTemplate(
      'Repo: {{ run.params.repo }}\nCtx: {{ workflow.context.guidelines }}',
      {
        evidenceByStep: {},
        runParams: { repo: 'acme/app' },
        workflowContext: {
          snapshots: { guidelines: contextSnapshot },
          wrapper: 'none',
        },
      },
    );
    expect(result).toBe('Repo: acme/app\nCtx: Be concise.');
  });
});

// ─── applyFilter ────────────────────────────────────────────────────────────

describe('applyFilter — bullets', () => {
  it('converts a string array to bullet lines', () => {
    const r = applyFilter(['alpha', 'beta', 'gamma'], 'bullets', []);
    expect(r).toEqual({ ok: true, value: '• alpha\n• beta\n• gamma' });
  });

  it('returns undefined for an empty array', () => {
    const r = applyFilter([], 'bullets', []);
    expect(r).toEqual({ ok: true, value: undefined });
  });

  it('returns type_mismatch for non-array input', () => {
    expect(applyFilter('not an array', 'bullets', [])).toEqual({ ok: false, reason: 'type_mismatch' });
    expect(applyFilter(42, 'bullets', [])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

describe('applyFilter — join', () => {
  it('joins array with default separator', () => {
    const r = applyFilter(['a', 'b', 'c'], 'join', []);
    expect(r).toEqual({ ok: true, value: 'a, b, c' });
  });

  it('joins array with custom separator', () => {
    const r = applyFilter(['x', 'y'], 'join', [' / ']);
    expect(r).toEqual({ ok: true, value: 'x / y' });
  });

  it('returns type_mismatch for non-array input', () => {
    expect(applyFilter('hello', 'join', [])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

describe('applyFilter — default', () => {
  it('returns fallback arg when value is undefined', () => {
    expect(applyFilter(undefined, 'default', ['N/A'])).toEqual({ ok: true, value: 'N/A' });
  });

  it('returns fallback arg when value is null', () => {
    expect(applyFilter(null, 'default', ['none'])).toEqual({ ok: true, value: 'none' });
  });

  it('returns empty string when no arg and value is undefined', () => {
    expect(applyFilter(undefined, 'default', [])).toEqual({ ok: true, value: '' });
  });

  it('passes through empty string unchanged', () => {
    expect(applyFilter('', 'default', ['N/A'])).toEqual({ ok: true, value: '' });
  });

  it('passes through 0 unchanged', () => {
    expect(applyFilter(0, 'default', ['N/A'])).toEqual({ ok: true, value: 0 });
  });

  it('passes through false unchanged', () => {
    expect(applyFilter(false, 'default', ['N/A'])).toEqual({ ok: true, value: false });
  });

  it('passes through a truthy value unchanged', () => {
    expect(applyFilter('hello', 'default', ['N/A'])).toEqual({ ok: true, value: 'hello' });
  });
});

describe('applyFilter — upper', () => {
  it('uppercases a string', () => {
    expect(applyFilter('hello world', 'upper', [])).toEqual({ ok: true, value: 'HELLO WORLD' });
  });

  it('returns type_mismatch for non-string input', () => {
    expect(applyFilter(42, 'upper', [])).toEqual({ ok: false, reason: 'type_mismatch' });
    expect(applyFilter(['a'], 'upper', [])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

describe('applyFilter — truncate', () => {
  it('returns string as-is when shorter than limit', () => {
    expect(applyFilter('short', 'truncate', ['100'])).toEqual({ ok: true, value: 'short' });
  });

  it('cuts at word boundary and appends ellipsis', () => {
    const r = applyFilter('hello world foo bar', 'truncate', ['12']);
    expect(r).toEqual({ ok: true, value: 'hello world…' });
  });

  it('hard-cuts when no word boundary exists within limit', () => {
    const r = applyFilter('abcdefghij', 'truncate', ['5']);
    expect(r).toEqual({ ok: true, value: 'abcde…' });
  });

  it('returns type_mismatch for non-string input', () => {
    expect(applyFilter(42, 'truncate', ['10'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('returns type_mismatch when no arg provided', () => {
    expect(applyFilter('hello', 'truncate', [])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('returns type_mismatch when arg is non-numeric', () => {
    expect(applyFilter('hello', 'truncate', ['abc'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

describe('applyFilter — unknown', () => {
  it('returns unknown_filter result with the filter name', () => {
    expect(applyFilter('val', 'nonexistent', [])).toEqual({
      ok: false,
      reason: 'unknown_filter',
      filterName: 'nonexistent',
    });
  });
});

// ─── Tier 2 filters ──────────────────────────────────────────────────────────

describe('applyFilter — pluck', () => {
  it('extracts values for the given key from each object', () => {
    expect(applyFilter([{ name: 'a' }, { name: 'b' }], 'pluck', ['name'])).toEqual({
      ok: true,
      value: ['a', 'b'],
    });
  });

  it('omits items where the key is absent', () => {
    expect(applyFilter([{ name: 'a' }, {}], 'pluck', ['name'])).toEqual({
      ok: true,
      value: ['a'],
    });
  });

  it('omits non-object items (string)', () => {
    expect(applyFilter(['x', 'y'], 'pluck', ['name'])).toEqual({ ok: true, value: [] });
  });

  it('omits null items', () => {
    expect(applyFilter([null, { name: 'a' }], 'pluck', ['name'])).toEqual({
      ok: true,
      value: ['a'],
    });
  });

  it('returns empty array when all items are omitted', () => {
    expect(applyFilter([1, 2, 3], 'pluck', ['name'])).toEqual({ ok: true, value: [] });
  });

  it('returns type_mismatch for non-array input', () => {
    expect(applyFilter(42, 'pluck', ['name'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('returns type_mismatch when arg is missing', () => {
    expect(applyFilter([{ name: 'a' }], 'pluck', [])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('returns type_mismatch when arg is empty string', () => {
    expect(applyFilter([{ name: 'a' }], 'pluck', [''])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

describe('applyFilter — count', () => {
  it('returns the array length as a string', () => {
    expect(applyFilter(['a', 'b', 'c'], 'count', [])).toEqual({ ok: true, value: '3' });
  });

  it('returns "0" for an empty array', () => {
    expect(applyFilter([], 'count', [])).toEqual({ ok: true, value: '0' });
  });

  it('returns type_mismatch for non-array input', () => {
    expect(applyFilter(42, 'count', [])).toEqual({ ok: false, reason: 'type_mismatch' });
    expect(applyFilter('hello', 'count', [])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('ignores args', () => {
    expect(applyFilter(['a'], 'count', ['ignored'])).toEqual({ ok: true, value: '1' });
  });
});

describe('applyFilter — limit', () => {
  it('returns first N items', () => {
    expect(applyFilter([1, 2, 3, 4, 5], 'limit', ['3'])).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it('returns full array when N >= length', () => {
    expect(applyFilter([1, 2], 'limit', ['10'])).toEqual({ ok: true, value: [1, 2] });
  });

  it('returns empty array for limit 0', () => {
    expect(applyFilter([1, 2, 3], 'limit', ['0'])).toEqual({ ok: true, value: [] });
  });

  it('returns type_mismatch for NaN arg', () => {
    expect(applyFilter([1, 2], 'limit', ['abc'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('returns type_mismatch when no arg provided', () => {
    expect(applyFilter([1, 2], 'limit', [])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('returns type_mismatch for non-array input', () => {
    expect(applyFilter(42, 'limit', ['2'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

describe('applyFilter — compact', () => {
  it('removes null and undefined, keeps other values', () => {
    expect(applyFilter(['a', null, 'b', undefined, 'c'], 'compact', [])).toEqual({
      ok: true,
      value: ['a', 'b', 'c'],
    });
  });

  it('keeps falsy values 0, empty string, and false', () => {
    expect(applyFilter([0, '', false, null], 'compact', [])).toEqual({
      ok: true,
      value: [0, '', false],
    });
  });

  it('returns the same array when no nulls or undefineds present', () => {
    expect(applyFilter([1, 2, 3], 'compact', [])).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it('returns type_mismatch for non-array input', () => {
    expect(applyFilter(42, 'compact', [])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

describe('applyFilter — round', () => {
  it('rounds to specified decimal places', () => {
    expect(applyFilter(3.14159, 'round', ['2'])).toEqual({ ok: true, value: '3.14' });
  });

  it('rounds to 0 places when arg is 0', () => {
    expect(applyFilter(3.14159, 'round', ['0'])).toEqual({ ok: true, value: '3' });
  });

  it('defaults to 0 decimal places when no arg', () => {
    expect(applyFilter(3.14159, 'round', [])).toEqual({ ok: true, value: '3' });
  });

  it('defaults to 0 decimal places when arg is empty string', () => {
    expect(applyFilter(3.7, 'round', [''])).toEqual({ ok: true, value: '4' });
  });

  it('returns type_mismatch for non-number input', () => {
    expect(applyFilter('hello', 'round', ['2'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('returns type_mismatch for NaN arg (unparseable string)', () => {
    expect(applyFilter(3.14, 'round', ['abc'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

describe('applyFilter — percent', () => {
  it('formats fraction to percent with specified decimal places', () => {
    expect(applyFilter(0.857, 'percent', ['1'])).toEqual({ ok: true, value: '85.7%' });
  });

  it('defaults to 0 decimal places when no arg', () => {
    expect(applyFilter(0.857, 'percent', [])).toEqual({ ok: true, value: '86%' });
  });

  it('defaults to 0 decimal places when arg is empty string', () => {
    expect(applyFilter(0.5, 'percent', [''])).toEqual({ ok: true, value: '50%' });
  });

  it('handles 1.0 as 100%', () => {
    expect(applyFilter(1.0, 'percent', ['0'])).toEqual({ ok: true, value: '100%' });
  });

  it('accepts values outside [0, 1] without error', () => {
    expect(applyFilter(1.5, 'percent', ['0'])).toEqual({ ok: true, value: '150%' });
  });

  it('returns type_mismatch for non-number input', () => {
    expect(applyFilter('hello', 'percent', ['1'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('returns type_mismatch for NaN arg', () => {
    expect(applyFilter(0.5, 'percent', ['abc'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

describe('applyFilter — replace', () => {
  it('replaces all occurrences of a substring', () => {
    expect(applyFilter('hello world', 'replace', ['world', 'there'])).toEqual({
      ok: true,
      value: 'hello there',
    });
  });

  it('replaces all occurrences (multiple matches)', () => {
    expect(applyFilter('aaa', 'replace', ['a', 'b'])).toEqual({ ok: true, value: 'bbb' });
  });

  it('returns input unchanged when search string not found', () => {
    expect(applyFilter('hello', 'replace', ['xyz', 'abc'])).toEqual({ ok: true, value: 'hello' });
  });

  it('deletes occurrences when replacement is empty string', () => {
    expect(applyFilter('hello', 'replace', ['l', ''])).toEqual({ ok: true, value: 'heo' });
  });

  it('handles quoted comma as search arg', () => {
    expect(applyFilter('a,b,c', 'replace', [',', ' / '])).toEqual({
      ok: true,
      value: 'a / b / c',
    });
  });

  it('is case-sensitive (no match on wrong case)', () => {
    expect(applyFilter('Error', 'replace', ['error', 'x'])).toEqual({ ok: true, value: 'Error' });
  });

  it('returns type_mismatch for empty search string', () => {
    expect(applyFilter('hello', 'replace', ['', 'x'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('returns type_mismatch when replacement arg is missing (one arg)', () => {
    expect(applyFilter('hello', 'replace', ['l'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('returns type_mismatch for empty args array', () => {
    expect(applyFilter('hello', 'replace', [])).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('returns type_mismatch for non-string input', () => {
    expect(applyFilter(42, 'replace', [',', '.'])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

describe('applyFilter — yesno', () => {
  it('returns "yes" for true', () => {
    expect(applyFilter(true, 'yesno', [])).toEqual({ ok: true, value: 'yes' });
  });

  it('returns "no" for false', () => {
    expect(applyFilter(false, 'yesno', [])).toEqual({ ok: true, value: 'no' });
  });

  it('one arg, true → falls back to default "yes"', () => {
    expect(applyFilter(true, 'yesno', ['Active'])).toEqual({ ok: true, value: 'yes' });
  });

  it('one arg, false → falls back to default "no"', () => {
    expect(applyFilter(false, 'yesno', ['Active'])).toEqual({ ok: true, value: 'no' });
  });

  it('two args, true → first arg', () => {
    expect(applyFilter(true, 'yesno', ['Active', 'Off'])).toEqual({ ok: true, value: 'Active' });
  });

  it('two args, false → second arg', () => {
    expect(applyFilter(false, 'yesno', ['Active', 'Off'])).toEqual({ ok: true, value: 'Off' });
  });

  it('three args ignored beyond first two', () => {
    expect(applyFilter(true, 'yesno', ['Active', 'Off', 'extra'])).toEqual({ ok: true, value: 'Active' });
  });

  it('returns type_mismatch for non-boolean input', () => {
    expect(applyFilter(42, 'yesno', [])).toEqual({ ok: false, reason: 'type_mismatch' });
    expect(applyFilter('true', 'yesno', [])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

describe('applyFilter — and_join', () => {
  it('returns undefined for empty array', () => {
    expect(applyFilter([], 'and_join', [])).toEqual({ ok: true, value: undefined });
  });

  it('returns the single item for one-element array', () => {
    expect(applyFilter(['a'], 'and_join', [])).toEqual({ ok: true, value: 'a' });
  });

  it('joins two items with "and" (no comma)', () => {
    expect(applyFilter(['a', 'b'], 'and_join', [])).toEqual({ ok: true, value: 'a and b' });
  });

  it('joins three items with Oxford comma', () => {
    expect(applyFilter(['a', 'b', 'c'], 'and_join', [])).toEqual({ ok: true, value: 'a, b, and c' });
  });

  it('joins four items with Oxford comma', () => {
    expect(applyFilter(['a', 'b', 'c', 'd'], 'and_join', [])).toEqual({
      ok: true,
      value: 'a, b, c, and d',
    });
  });

  it('stringifies non-string elements', () => {
    expect(applyFilter([1, 2, 3], 'and_join', [])).toEqual({ ok: true, value: '1, 2, and 3' });
  });

  it('returns type_mismatch for non-array input', () => {
    expect(applyFilter(42, 'and_join', [])).toEqual({ ok: false, reason: 'type_mismatch' });
  });
});

// ─── renderTemplate with filters ─────────────────────────────────────────────

describe('renderTemplate — pipe filter syntax', () => {
  it('applies upper filter', () => {
    const result = renderTemplate('Value: {{ run.params.env | upper }}', {
      evidenceByStep: {},
      runParams: { env: 'production' },
    });
    expect(result).toBe('Value: PRODUCTION');
  });

  it('applies bullets filter to an array', () => {
    const result = renderTemplate('Items:\n{{ context.resources.step_a.items | bullets }}', {
      evidenceByStep: { step_a: { items: ['one', 'two', 'three'] } } as unknown as Record<string, Record<string, unknown>>,
      runParams: {},
    });
    expect(result).toBe('Items:\n• one\n• two\n• three');
  });

  it('leaves placeholder intact when bullets receives empty array', () => {
    const result = renderTemplate('{{ context.resources.step_a.items | bullets }}', {
      evidenceByStep: { step_a: { items: [] } } as unknown as Record<string, Record<string, unknown>>,
      runParams: {},
    });
    expect(result).toBe('{{ context.resources.step_a.items | bullets }}');
  });

  it('applies join with quoted separator arg', () => {
    const result = renderTemplate('Tags: {{ context.resources.step_a.tags | join: " / " }}', {
      evidenceByStep: { step_a: { tags: ['bug', 'urgent'] } } as unknown as Record<string, Record<string, unknown>>,
      runParams: {},
    });
    expect(result).toBe('Tags: bug / urgent');
  });

  it('applies default filter when path is unresolvable (undefined)', () => {
    const result = renderTemplate('Status: {{ run.params.status | default: unknown }}', {
      evidenceByStep: {},
      runParams: {},
    });
    expect(result).toBe('Status: unknown');
  });

  it('default filter does not fire on empty string', () => {
    const result = renderTemplate('S: {{ run.params.s | default: fallback }}', {
      evidenceByStep: {},
      runParams: { s: '' },
    });
    expect(result).toBe('S: ');
  });

  it('applies truncate filter', () => {
    const result = renderTemplate('Summary: {{ run.params.text | truncate: 10 }}', {
      evidenceByStep: {},
      runParams: { text: 'This is a long summary text' },
    });
    expect(result).toBe('Summary: This is a…');
  });

  it('chains two filters', () => {
    const result = renderTemplate('{{ run.params.env | default: dev | upper }}', {
      evidenceByStep: {},
      runParams: {},
    });
    expect(result).toBe('DEV');
  });

  it('leaves placeholder intact on type_mismatch', () => {
    const result = renderTemplate('{{ run.params.num | upper }}', {
      evidenceByStep: {},
      runParams: { num: 42 },
    });
    expect(result).toBe('{{ run.params.num | upper }}');
  });

  it('leaves placeholder intact on unknown filter in lenient mode (no strict option)', () => {
    const result = renderTemplate('{{ run.params.x | bogus }}', {
      evidenceByStep: {},
      runParams: { x: 'hello' },
    });
    expect(result).toBe('{{ run.params.x | bogus }}');
  });

  it('short-circuit on type_mismatch prevents downstream default from firing', () => {
    // num = 42 causes upper to type_mismatch; default: must not fire
    const result = renderTemplate('{{ run.params.num | upper | default: fallback }}', {
      evidenceByStep: {},
      runParams: { num: 42 },
    });
    expect(result).toBe('{{ run.params.num | upper | default: fallback }}');
  });

  it('chains pluck and and_join over a step output array', () => {
    const result = renderTemplate(
      '{{ context.resources.step.items | pluck: "name" | and_join }}',
      {
        evidenceByStep: {
          step: { items: [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }] },
        } as unknown as Record<string, Record<string, unknown>>,
        runParams: {},
      },
    );
    expect(result).toBe('alpha, beta, and gamma');
  });

  it('applies percent filter to a numeric run param', () => {
    const result = renderTemplate('Confidence: {{ run.params.score | percent: 1 }}', {
      evidenceByStep: {},
      runParams: { score: 0.857 },
    });
    expect(result).toBe('Confidence: 85.7%');
  });

  it('applies replace filter with quoted comma in arg', () => {
    const result = renderTemplate('{{ run.params.csv | replace: ",", " | " }}', {
      evidenceByStep: {},
      runParams: { csv: 'a,b,c' },
    });
    expect(result).toBe('a | b | c');
  });

  it('quoted arg containing pipe is not treated as a filter separator', () => {
    const result = renderTemplate('{{ run.params.s | replace: "x", "a|b" }}', {
      evidenceByStep: {},
      runParams: { s: 'x' },
    });
    expect(result).toBe('a|b');
  });

  it('unquoted args are trimmed', () => {
    const result = renderTemplate('{{ run.params.s | replace: x , y }}', {
      evidenceByStep: {},
      runParams: { s: 'x' },
    });
    expect(result).toBe('y');
  });
});

// ─── renderTemplate — strict mode ────────────────────────────────────────────

describe('renderTemplate — strict mode', () => {
  it('throws UnknownFilterError for unknown filter when strict: true', () => {
    expect(() =>
      renderTemplate('{{ run.params.x | bogus }}', {
        evidenceByStep: {},
        runParams: { x: 'hello' },
      }, { strict: true }),
    ).toThrow(UnknownFilterError);
  });

  it('thrown UnknownFilterError carries the filter name', () => {
    try {
      renderTemplate('{{ run.params.x | bogus }}', {
        evidenceByStep: {},
        runParams: { x: 'hello' },
      }, { strict: true });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownFilterError);
      expect((err as UnknownFilterError).filterName).toBe('bogus');
    }
  });

  it('does NOT throw for type_mismatch even in strict mode — leaves placeholder intact', () => {
    const result = renderTemplate('{{ run.params.num | upper }}', {
      evidenceByStep: {},
      runParams: { num: 42 },
    }, { strict: true });
    expect(result).toBe('{{ run.params.num | upper }}');
  });

  it('resolves known filters successfully in strict mode', () => {
    const result = renderTemplate('{{ run.params.env | upper }}', {
      evidenceByStep: {},
      runParams: { env: 'staging' },
    }, { strict: true });
    expect(result).toBe('STAGING');
  });
});


