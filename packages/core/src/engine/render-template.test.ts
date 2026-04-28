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


