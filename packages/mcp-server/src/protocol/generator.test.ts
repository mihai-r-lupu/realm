// Tests for the protocol generator — generateProtocol from WorkflowDefinition.
import { describe, it, expect } from 'vitest';
import { loadWorkflowFromFile } from '@sensigo/realm';
import { join } from 'node:path';
import { generateProtocol } from './generator.js';
import type { WorkflowDefinition } from '@sensigo/realm';

const MULTI_STEP_FIXTURE = join(
  new URL('../../fixtures/multi-step-workflow.yaml', import.meta.url).pathname,
);

describe('generateProtocol', () => {
  it('generates protocol for a 4-step workflow', () => {
    const definition = loadWorkflowFromFile(MULTI_STEP_FIXTURE);
    const protocol = generateProtocol(definition);

    expect(protocol.workflow_id).toBe('multi-step-demo');
    expect(protocol.steps.length).toBe(4);

    const fetchDoc = protocol.steps.find((s) => s.id === 'fetch_document')!;
    expect(fetchDoc.agent_involvement).toContain('automatically');

    const extractFields = protocol.steps.find((s) => s.id === 'extract_fields')!;
    expect(extractFields.agent_involvement).toContain('YOU execute');

    const finalize = protocol.steps.find((s) => s.id === 'finalize')!;
    expect(finalize.agent_involvement).toContain('confirm');
    expect(finalize.possible_gate).toBeDefined();

    expect(protocol.agent_steps_summary).toContain('1 of 4');
    expect(protocol.rules.length).toBeGreaterThanOrEqual(1);
    expect(protocol.error_handling).toHaveProperty('provide_input');
    expect(protocol.error_handling).toHaveProperty('report_to_user');
    expect(protocol.error_handling).toHaveProperty('stop');
    expect(protocol.quick_start.length).toBeGreaterThan(0);
  });

  it('uses protocol.quick_start override when present', () => {
    const definition: WorkflowDefinition = {
      id: 'test-wf',
      name: 'Test',
      version: 1,
      initial_state: 'created',
      protocol: { quick_start: 'Custom start' },
      steps: {},
    };
    const protocol = generateProtocol(definition);
    expect(protocol.quick_start).toBe('Custom start');
  });

  it('uses protocol.rules override when present', () => {
    const definition: WorkflowDefinition = {
      id: 'test-wf',
      name: 'Test',
      version: 1,
      initial_state: 'created',
      protocol: { rules: ['Rule A'] },
      steps: {},
    };
    const protocol = generateProtocol(definition);
    expect(protocol.rules).toEqual(['Rule A']);
  });

  it('auto step with trust: human_confirmed gets possible_gate', () => {
    const definition: WorkflowDefinition = {
      id: 'test-wf',
      name: 'Test',
      version: 1,
      initial_state: 'created',
      steps: {
        'gate-step': {
          description: 'A gate step',
          execution: 'auto',
          trust: 'human_confirmed',
          allowed_from_states: ['created'],
          produces_state: 'done',
        },
      },
    };
    const protocol = generateProtocol(definition);
    const step = protocol.steps[0]!;
    expect(step.possible_gate).toBeDefined();
    expect(step.possible_gate!.choices).toContain('approve');
    expect(step.agent_involvement).toContain('confirm');
  });

  it('agent step with resolved profile includes agent_profile_instructions', () => {
    const definition: WorkflowDefinition = {
      id: 'test-wf',
      name: 'Test',
      version: 1,
      initial_state: 'created',
      steps: {
        'profiled-step': {
          description: 'A profiled agent step',
          execution: 'agent',
          allowed_from_states: ['created'],
          produces_state: 'done',
          agent_profile: 'my-profile',
        },
      },
      resolved_profiles: {
        'my-profile': { content: 'You are a specialist.', content_hash: 'abc123' },
      },
    };
    const protocol = generateProtocol(definition);
    const step = protocol.steps[0]!;
    expect(step.agent_profile_instructions).toBe('You are a specialist.');
  });

  it('agent step with agent_profile but no resolved_profiles omits agent_profile_instructions', () => {
    const definition: WorkflowDefinition = {
      id: 'test-wf',
      name: 'Test',
      version: 1,
      initial_state: 'created',
      steps: {
        'profiled-step': {
          description: 'A profiled agent step',
          execution: 'agent',
          allowed_from_states: ['created'],
          produces_state: 'done',
          agent_profile: 'my-profile',
        },
      },
    };
    const protocol = generateProtocol(definition);
    const step = protocol.steps[0]!;
    expect(step.agent_profile_instructions).toBeUndefined();
  });
});
