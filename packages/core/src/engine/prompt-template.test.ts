import { describe, it, expect } from 'vitest';
import { resolvePromptTemplate } from './prompt-template.js';

const evidence = {
  review_security: {
    findings: [{ severity: 'critical', description: 'SQL injection' }],
  },
};
const params = { code: 'const x = 1;', repo: 'acme/app' };

describe('resolvePromptTemplate', () => {
  it('resolves run.params reference', () => {
    const result = resolvePromptTemplate('Code: {{ run.params.code }}', {
      evidenceByStep: {},
      runParams: params,
    });
    expect(result).toBe('Code: const x = 1;');
  });

  it('resolves context.resources reference to an object (JSON stringified)', () => {
    const result = resolvePromptTemplate(
      'Findings: {{ context.resources.review_security.findings }}',
      { evidenceByStep: evidence, runParams: {} },
    );
    expect(result).toContain('SQL injection');
    expect(result).toContain('critical');
  });

  it('leaves unresolvable reference as-is', () => {
    const result = resolvePromptTemplate('Missing: {{ run.params.nonexistent }}', {
      evidenceByStep: {},
      runParams: {},
    });
    expect(result).toBe('Missing: {{ run.params.nonexistent }}');
  });

  it('resolves multiple references in one template', () => {
    const result = resolvePromptTemplate(
      'Repo: {{ run.params.repo }}\nFindings: {{ context.resources.review_security.findings }}',
      { evidenceByStep: evidence, runParams: params },
    );
    expect(result).toContain('acme/app');
    expect(result).toContain('SQL injection');
  });

  it('returns template unchanged when it has no {{ }} tokens', () => {
    const tmpl = 'Analyze the code for security issues.';
    expect(resolvePromptTemplate(tmpl, { evidenceByStep: {}, runParams: {} })).toBe(tmpl);
  });

  it('handles deeply nested paths', () => {
    const deepEvidence = { step_a: { nested: { value: 42 } } };
    const result = resolvePromptTemplate('{{ context.resources.step_a.nested }}', {
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

describe('resolvePromptTemplate — workflow.context namespace', () => {
  it('{{ workflow.context.NAME }} with wrapper xml wraps in XML tags', () => {
    const result = resolvePromptTemplate('{{ workflow.context.guidelines }}', {
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
    const result = resolvePromptTemplate('{{ workflow.context.guidelines }}', {
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
    const result = resolvePromptTemplate('{{ workflow.context.guidelines }}', {
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
    const result = resolvePromptTemplate('{{ workflow.context.guidelines.raw }}', {
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
    const result = resolvePromptTemplate('{{ workflow.context.missing }}', {
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
    const result = resolvePromptTemplate('{{ workflow.context.guidelines }}', {
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
    const result = resolvePromptTemplate('{{ workflow.context.guidelines }}', {
      evidenceByStep: {},
      runParams: {},
    });
    expect(result).toBe('{{ workflow.context.guidelines }}');
  });

  it('existing {{ context.resources.* }} and {{ run.params.* }} continue to work alongside workflow.context', () => {
    const result = resolvePromptTemplate(
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

