import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadWorkflowFromString, loadWorkflowFromFile } from './yaml-loader.js';
import { WorkflowError } from '../types/workflow-error.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VALID_YAML = `
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

describe('loadWorkflowFromString', () => {
  it('valid YAML string returns correct WorkflowDefinition', () => {
    const def = loadWorkflowFromString(VALID_YAML);
    expect(def.id).toBe('test-workflow');
    expect(def.name).toBe('Test Workflow');
    expect(def.version).toBe(1);
    expect(Object.keys(def.steps)).toHaveLength(2);
  });

  it('missing top-level field throws WorkflowError', () => {
    const content = VALID_YAML.replace('id: test-workflow\n', '');
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });

  it('step with unknown uses_service throws WorkflowError', () => {
    const content = VALID_YAML.replace(
      'produces_state: completed',
      'produces_state: completed\n    uses_service: nonexistent-service',
    );
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });

  it('invalid execution value throws WorkflowError', () => {
    const content = VALID_YAML.replace('execution: auto', 'execution: invalid_mode');
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });

  it('invalid service_method value throws WorkflowError containing service_method', () => {
    const content = VALID_YAML.replace(
      'produces_state: step_one_done',
      'produces_state: step_one_done\n    service_method: invalid_value',
    );
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
    try {
      loadWorkflowFromString(content);
    } catch (err) {
      expect((err as WorkflowError).message).toContain('service_method');
    }
  });

  it('produces_state collision throws WorkflowError', () => {
    const content = VALID_YAML.replace(
      'produces_state: completed',
      'produces_state: step_one_done',
    );
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });

  it('step allowed_from_state references state never produced throws WorkflowError', () => {
    const content = VALID_YAML + `
  step-three:
    description: Orphan step
    execution: auto
    allowed_from_states: [nonexistent_state]
    produces_state: orphan_done
`;
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
  });

  it('rejects workflows with duplicate allowed_from_states', () => {
    const content = VALID_YAML + `
  step-dupe:
    description: Duplicate source step
    execution: auto
    allowed_from_states: [created]
    produces_state: dupe_done
`;
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
    try {
      loadWorkflowFromString(content);
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError);
      expect((err as WorkflowError).code).toBe('VALIDATION_WORKFLOW_SCHEMA');
      expect((err as WorkflowError).message).toContain('Ambiguous routing');
    }
  });
});

describe('transitions validation', () => {
  const TRANSITIONS_BASE = `
id: transitions-wf
name: Transitions Workflow
version: 1
initial_state: created
steps:
  auto_step:
    description: Auto step with handler
    execution: auto
    handler: my_handler
    allowed_from_states: [created]
    produces_state: processed
  recovery_step:
    description: Agent recovery step
    execution: agent
    allowed_from_states: [recovery_needed]
    produces_state: completed
`;

  it('valid on_error transition parses correctly', () => {
    const content = TRANSITIONS_BASE.replace(
      'produces_state: processed',
      'produces_state: processed\n    transitions:\n      on_error:\n        step: recovery_step\n        produces_state: recovery_needed',
    );
    const def = loadWorkflowFromString(content);
    expect(def.steps['auto_step']?.transitions?.['on_error']?.step).toBe('recovery_step');
    expect(def.steps['auto_step']?.transitions?.['on_error']?.produces_state).toBe('recovery_needed');
  });

  it('on_error on an agent step throws WorkflowError', () => {
    const content = TRANSITIONS_BASE.replace(
      'produces_state: completed',
      'produces_state: completed\n    transitions:\n      on_error:\n        step: auto_step\n        produces_state: created',
    );
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
    try {
      loadWorkflowFromString(content);
    } catch (err) {
      expect((err as WorkflowError).message).toContain("'on_error' transition is only valid on execution: auto steps");
    }
  });

  it('transition targeting unknown step throws WorkflowError', () => {
    const content = TRANSITIONS_BASE.replace(
      'produces_state: processed',
      'produces_state: processed\n    transitions:\n      on_error:\n        step: nonexistent_step\n        produces_state: recovery_needed',
    );
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
    try {
      loadWorkflowFromString(content);
    } catch (err) {
      expect((err as WorkflowError).message).toContain("targets unknown step 'nonexistent_step'");
    }
  });

  it('transition produces_state not in target allowed_from_states throws WorkflowError', () => {
    const content = TRANSITIONS_BASE.replace(
      'produces_state: processed',
      'produces_state: processed\n    transitions:\n      on_error:\n        step: recovery_step\n        produces_state: wrong_state',
    );
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
    try {
      loadWorkflowFromString(content);
    } catch (err) {
      expect((err as WorkflowError).message).toContain("produces_state 'wrong_state' is not in step 'recovery_step'.allowed_from_states");
    }
  });

  it('gate-response transition key not in gate choices throws WorkflowError', () => {
    const content = `
id: gate-transition-wf
name: Gate Transition Workflow
version: 1
initial_state: created
steps:
  gate_step:
    description: Gate step
    execution: auto
    trust: human_confirmed
    allowed_from_states: [created]
    produces_state: approved
    gate:
      choices: [approve, reject]
    transitions:
      on_cancel:
        step: recovery_step
        produces_state: recovery_needed
  recovery_step:
    description: Recovery step
    execution: agent
    allowed_from_states: [recovery_needed]
    produces_state: completed
`;
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
    try {
      loadWorkflowFromString(content);
    } catch (err) {
      expect((err as WorkflowError).message).toContain("transition key 'on_cancel' is not in gate choices");
    }
  });
});

describe('loadWorkflowFromFile', () => {
  it('nonexistent file throws WorkflowError with code RESOURCE_FETCH_FAILED', () => {
    expect(() => loadWorkflowFromFile('/nonexistent/path/workflow.yaml')).toThrow(WorkflowError);
    try {
      loadWorkflowFromFile('/nonexistent/path/workflow.yaml');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError);
      expect((err as WorkflowError).code).toBe('RESOURCE_FETCH_FAILED');
    }
  });
});

describe('loadWorkflowFromString — agent_profile validation', () => {
  it('agent_profile on auto step throws WorkflowError', () => {
    const content = `
id: test-wf
name: Test
version: 1
initial_state: created
steps:
  bad-step:
    description: Bad
    execution: auto
    agent_profile: some-profile
    allowed_from_states: [created]
    produces_state: done
`;
    expect(() => loadWorkflowFromString(content)).toThrow(WorkflowError);
    try {
      loadWorkflowFromString(content);
    } catch (err) {
      expect((err as WorkflowError).message).toContain("agent_profile' is only valid on execution: agent steps");
    }
  });
});

describe('loadWorkflowFromFile — agent profile resolution', () => {
  let tmpDir: string;
  const workflowYaml = `
id: profile-wf
name: Profile Workflow
version: 1
initial_state: created
steps:
  agent-step:
    description: Agent step with profile
    execution: agent
    agent_profile: my-profile
    allowed_from_states: [created]
    produces_state: done
`;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'realm-profile-test-'));
    mkdirSync(join(tmpDir, 'agents'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves profile content and hash when agents/ directory exists', () => {
    writeFileSync(join(tmpDir, 'workflow.yaml'), workflowYaml);
    writeFileSync(join(tmpDir, 'agents', 'my-profile.md'), 'You are a helpful agent.');

    const def = loadWorkflowFromFile(join(tmpDir, 'workflow.yaml'));
    expect(def.resolved_profiles).toBeDefined();
    expect(def.resolved_profiles!['my-profile']).toBeDefined();
    expect(def.resolved_profiles!['my-profile']!.content).toBe('You are a helpful agent.');
    expect(def.resolved_profiles!['my-profile']!.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws WorkflowError when profile file is missing', () => {
    writeFileSync(join(tmpDir, 'workflow.yaml'), workflowYaml);
    // no agents/my-profile.md written

    expect(() => loadWorkflowFromFile(join(tmpDir, 'workflow.yaml'))).toThrow(WorkflowError);
    try {
      loadWorkflowFromFile(join(tmpDir, 'workflow.yaml'));
    } catch (err) {
      expect((err as WorkflowError).message).toContain("agent_profile 'my-profile' not found");
      expect((err as WorkflowError).message).toContain('my-profile.md');
    }
  });

  it('shared profile used by two steps is resolved once with the same hash', () => {
    const sharedYaml = `
id: shared-profile-wf
name: Shared Profile Workflow
version: 1
initial_state: created
steps:
  step-a:
    description: First agent step
    execution: agent
    agent_profile: shared-profile
    allowed_from_states: [created]
    produces_state: step_a_done
  step-b:
    description: Second agent step
    execution: agent
    agent_profile: shared-profile
    allowed_from_states: [step_a_done]
    produces_state: done
`;
    writeFileSync(join(tmpDir, 'workflow.yaml'), sharedYaml);
    writeFileSync(join(tmpDir, 'agents', 'shared-profile.md'), 'Shared persona content.');

    const def = loadWorkflowFromFile(join(tmpDir, 'workflow.yaml'));
    expect(def.resolved_profiles).toBeDefined();
    const keys = Object.keys(def.resolved_profiles!);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe('shared-profile');
    expect(def.resolved_profiles!['shared-profile']!.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('custom profiles_dir is used when declared', () => {
    const customProfilesDir = join(tmpDir, 'custom-profiles');
    mkdirSync(customProfilesDir);
    const customDirYaml = `
id: custom-dir-wf
name: Custom Dir Workflow
version: 1
initial_state: created
profiles_dir: ./custom-profiles
steps:
  agent-step:
    description: Agent step
    execution: agent
    agent_profile: custom-profile
    allowed_from_states: [created]
    produces_state: done
`;
    writeFileSync(join(tmpDir, 'workflow.yaml'), customDirYaml);
    writeFileSync(join(customProfilesDir, 'custom-profile.md'), 'Custom profile content.');

    const def = loadWorkflowFromFile(join(tmpDir, 'workflow.yaml'));
    expect(def.resolved_profiles!['custom-profile']!.content).toBe('Custom profile content.');
  });
});
