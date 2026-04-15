import { describe, it, expect } from 'vitest';
import { loadWorkflowFromString, WorkflowError } from '@sensigo/realm';

const VALID_WORKFLOW = `
id: test-workflow
name: Test Workflow
version: 1
steps:
  step-one:
    description: First step
    execution: auto
  step-two:
    description: Second step
    execution: agent
    depends_on: [step-one]
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
      'execution: agent',
      'execution: agent\n    uses_service: nonexistent-service',
    );
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });

  it('step with invalid execution value throws WorkflowError', () => {
    const content = VALID_WORKFLOW.replace('execution: auto', 'execution: invalid_mode');
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });
});
