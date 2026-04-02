import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { validateWorkflow } from './validate.js';

function runValidate(content: string): { success: boolean; message: string } {
  const raw = yaml.load(content);
  const { errors } = validateWorkflow(raw);
  if (errors.length === 0) {
    const doc = raw as { steps: Record<string, unknown>; version: number };
    return {
      success: true,
      message: `valid (${Object.keys(doc.steps).length} steps, version ${doc.version})`,
    };
  }
  return { success: false, message: errors.map((e) => e.message).join('; ') };
}

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

describe('validate command', () => {
  it('valid workflow YAML passes validation', () => {
    const result = runValidate(VALID_WORKFLOW);
    expect(result.success).toBe(true);
  });

  it('missing required field (id) produces error', () => {
    const content = VALID_WORKFLOW.replace('id: test-workflow\n', '');
    const result = runValidate(content);
    expect(result.success).toBe(false);
    expect(result.message).toContain("'id'");
  });

  it('step with unknown uses_service produces error', () => {
    const appended = VALID_WORKFLOW.replace(
      'produces_state: completed',
      'produces_state: completed\n    uses_service: nonexistent-service',
    );
    const result = runValidate(appended);
    expect(result.success).toBe(false);
    expect(result.message).toContain('nonexistent-service');
  });

  it('step with invalid execution value produces error', () => {
    const content = VALID_WORKFLOW.replace('execution: auto', 'execution: invalid_mode');
    const result = runValidate(content);
    expect(result.success).toBe(false);
    expect(result.message).toContain('invalid_mode');
  });

  it('produces_state collision produces error', () => {
    const content = VALID_WORKFLOW.replace(
      'produces_state: completed',
      'produces_state: step_one_done',
    );
    const result = runValidate(content);
    expect(result.success).toBe(false);
    expect(result.message).toContain('step_one_done');
  });
});
