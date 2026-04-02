import { describe, it, expect } from 'vitest';
import { loadWorkflowFromString, WorkflowError } from '@sensigo/realm';

const VALID_WORKFLOW = `
id: test-workflow
name: Test Workflow
version: 1
initial_state: created
steps:
  step-one:
    description: First step
    execution: auto
    allowed_from_states: [created]
    produces_state: step_one_done
  step-two:
    description: Second step
    execution: agent
    allowed_from_states: [step_one_done]
    produces_state: completed
`;

describe('validate command (via loadWorkflowFromString)', () => {
  it('valid workflow YAML parses without throwing', () => {
    expect(() => loadWorkflowFromString(VALID_WORKFLOW)).not.toThrow();
  });

  it('missing required field (id) throws WorkflowError', () => {
    const content = VALID_WORKFLOW.replace('id: test-workflow\n', '');
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });

  it('step with unknown uses_service throws WorkflowError', () => {
    const content = VALID_WORKFLOW.replace(
      'produces_state: completed',
      'produces_state: completed\n    uses_service: nonexistent-service',
    );
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });

  it('step with invalid execution value throws WorkflowError', () => {
    const content = VALID_WORKFLOW.replace('execution: auto', 'execution: invalid_mode');
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });

  it('duplicate produces_state throws WorkflowError', () => {
    const content = VALID_WORKFLOW.replace(
      'produces_state: completed',
      'produces_state: step_one_done',
    );
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });

  it('step allowed from state not produced by any step throws WorkflowError', () => {
    const content = VALID_WORKFLOW + `
  step-three:
    description: Orphan step
    execution: auto
    allowed_from_states: [nonexistent_state]
    produces_state: orphan_done
`;
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });
});
