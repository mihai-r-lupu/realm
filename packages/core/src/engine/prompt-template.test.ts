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
