// Tests for the lintWorkflowContext helper exported from the register command.
import { describe, it, expect } from 'vitest';
import { lintWorkflowContext } from './register.js';
import type { WorkflowDefinition } from '@sensigo/realm';
import { CURRENT_WORKFLOW_SCHEMA_VERSION } from '@sensigo/realm';

/** Builds a minimal WorkflowDefinition for lint testing. */
function makeDefinition(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    id: 'lint-test',
    name: 'Lint Test',
    version: 1,
    schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION,
    steps: {},
    ...overrides,
  };
}

describe('lintWorkflowContext', () => {
  it('returns empty array when workflow has no workflow_context', () => {
    const def = makeDefinition({
      steps: {
        step_one: { description: 'Step one', execution: 'agent', depends_on: [], prompt: 'Do something' },
      },
    });
    expect(lintWorkflowContext(def)).toEqual([]);
  });

  it('returns empty array when workflow_context is empty', () => {
    const def = makeDefinition({
      workflow_context: {},
      steps: {
        step_one: { description: 'Step one', execution: 'agent', depends_on: [], prompt: 'Do something' },
        step_two: { description: 'Step two', execution: 'agent', depends_on: ['step_one'], prompt: 'Do more' },
      },
    });
    expect(lintWorkflowContext(def)).toEqual([]);
  });

  it('returns no warning when fewer than 2 agent steps with prompts exist', () => {
    const def = makeDefinition({
      workflow_context: {
        rules: { source: { path: '/abs/rules.md' } },
      },
      steps: {
        only_step: {
          description: 'Only agent step',
          execution: 'agent',
          depends_on: [],
          prompt: 'Use rules: {{ workflow.context.rules }}',
        },
      },
    });
    expect(lintWorkflowContext(def)).toEqual([]);
  });

  it('returns no warning when context entry appeared in exactly half of agent step prompts (2 of 4)', () => {
    const def = makeDefinition({
      workflow_context: {
        rules: { source: { path: '/abs/rules.md' } },
      },
      steps: {
        step_a: { description: 'A', execution: 'agent', depends_on: [], prompt: 'Rules: {{ workflow.context.rules }}' },
        step_b: { description: 'B', execution: 'agent', depends_on: ['step_a'], prompt: 'Rules: {{ workflow.context.rules }}' },
        step_c: { description: 'C', execution: 'agent', depends_on: ['step_b'], prompt: 'No context here' },
        step_d: { description: 'D', execution: 'agent', depends_on: ['step_c'], prompt: 'No context here' },
      },
    });
    // 2 out of 4 steps reference rules — not > 2 (threshold), so no warning.
    expect(lintWorkflowContext(def)).toEqual([]);
  });

  it('returns warning when context entry referenced in more than half of agent step prompts (3 of 4)', () => {
    const def = makeDefinition({
      workflow_context: {
        rules: { source: { path: '/abs/rules.md' } },
      },
      steps: {
        step_a: { description: 'A', execution: 'agent', depends_on: [], prompt: 'Use {{ workflow.context.rules }}' },
        step_b: { description: 'B', execution: 'agent', depends_on: ['step_a'], prompt: 'Use {{ workflow.context.rules }}' },
        step_c: { description: 'C', execution: 'agent', depends_on: ['step_b'], prompt: 'Use {{ workflow.context.rules }}' },
        step_d: { description: 'D', execution: 'agent', depends_on: ['step_c'], prompt: 'No context reference here' },
      },
    });
    const warnings = lintWorkflowContext(def);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('workflow.context.rules');
    expect(warnings[0]).toContain('3 of 4');
  });

  it('auto steps without prompts are excluded from the agent step count', () => {
    const def = makeDefinition({
      workflow_context: {
        rules: { source: { path: '/abs/rules.md' } },
      },
      steps: {
        step_a: { description: 'A', execution: 'agent', depends_on: [], prompt: 'Use {{ workflow.context.rules }}' },
        step_b: { description: 'B', execution: 'agent', depends_on: ['step_a'], prompt: 'Use {{ workflow.context.rules }}' },
        step_c: { description: 'C', execution: 'agent', depends_on: ['step_b'], prompt: 'Use {{ workflow.context.rules }}' },
        auto_step: { description: 'Auto', execution: 'auto', depends_on: ['step_c'] },
      },
    });
    // 3 agent steps, all 3 reference rules → 3 > floor(3/2)=1 → warning issued.
    const warnings = lintWorkflowContext(def);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('3 of 3');
  });

  it('returns array (not throw) even when warnings are present — registration continues', () => {
    const def = makeDefinition({
      workflow_context: {
        rules: { source: { path: '/abs/rules.md' } },
      },
      steps: {
        step_a: { description: 'A', execution: 'agent', depends_on: [], prompt: '{{ workflow.context.rules }}' },
        step_b: { description: 'B', execution: 'agent', depends_on: ['step_a'], prompt: '{{ workflow.context.rules }}' },
        step_c: { description: 'C', execution: 'agent', depends_on: ['step_b'], prompt: '{{ workflow.context.rules }}' },
      },
    });
    expect(() => lintWorkflowContext(def)).not.toThrow();
    expect(Array.isArray(lintWorkflowContext(def))).toBe(true);
  });

  it('agent steps without a prompt field are excluded from the count', () => {
    const def = makeDefinition({
      workflow_context: {
        rules: { source: { path: '/abs/rules.md' } },
      },
      steps: {
        step_a: { description: 'A', execution: 'agent', depends_on: [], prompt: '{{ workflow.context.rules }}' },
        step_b: { description: 'B', execution: 'agent', depends_on: ['step_a'], prompt: '{{ workflow.context.rules }}' },
        // step_c is an agent step but has no prompt — should not count.
        step_c: { description: 'C', execution: 'agent', depends_on: ['step_b'] },
        step_d: { description: 'D', execution: 'agent', depends_on: ['step_c'] },
      },
    });
    // Only 2 agent steps have prompts (step_a and step_b), both reference rules.
    // 2 agent steps with prompts — threshold = floor(2/2) = 1, refCount = 2 > 1 → Warning.
    const warnings = lintWorkflowContext(def);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('2 of 2');
  });
});
