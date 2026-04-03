// Integration tests for MCP tool business logic — tests handle* functions directly.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileStore, JsonWorkflowStore } from '@sensigo/realm';
import type { WorkflowDefinition } from '@sensigo/realm';
import { handleListWorkflows } from './list-workflows.js';
import { handleGetWorkflowProtocol } from './get-workflow-protocol.js';
import { handleStartRun } from './start-run.js';
import { handleExecuteStep } from './execute-step.js';
import { handleSubmitHumanResponse } from './submit-human-response.js';
import { handleGetRunState } from './get-run-state.js';

/** Minimal 2-step workflow: auto → completed */
function makeSimpleDef(): WorkflowDefinition {
  return {
    id: 'simple-wf',
    name: 'Simple Workflow',
    version: 1,
    initial_state: 'created',
    steps: {
      'step-a': {
        description: 'Auto step',
        execution: 'auto',
        allowed_from_states: ['created'],
        produces_state: 'completed',
      },
    },
  };
}

/** 3-step workflow: auto → agent → completed */
function makeAgentDef(): WorkflowDefinition {
  return {
    id: 'agent-wf',
    name: 'Agent Workflow',
    version: 1,
    initial_state: 'created',
    steps: {
      'step-auto': {
        description: 'Auto step',
        execution: 'auto',
        allowed_from_states: ['created'],
        produces_state: 'state_a',
      },
      'step-agent': {
        description: 'Agent step',
        execution: 'agent',
        allowed_from_states: ['state_a'],
        produces_state: 'completed',
      },
    },
  };
}

/** Workflow with a human gate: auto → waiting → completed */
function makeGateDef(): WorkflowDefinition {
  return {
    id: 'gate-wf',
    name: 'Gate Workflow',
    version: 1,
    initial_state: 'created',
    steps: {
      'step-gate': {
        description: 'Gate step',
        execution: 'auto',
        trust: 'human_confirmed',
        allowed_from_states: ['created'],
        produces_state: 'approved',
      },
    },
  };
}

describe('mcp tool handlers', () => {
  let runDir: string;
  let workflowDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'realm-mcp-runs-'));
    workflowDir = await mkdtemp(join(tmpdir(), 'realm-mcp-wf-'));
  });

  it('handleListWorkflows returns registered workflows', async () => {
    const workflowStore = new JsonWorkflowStore(workflowDir);
    await workflowStore.register(makeSimpleDef());

    const result = await handleListWorkflows({ workflowStore });

    expect(result.workflows.length).toBe(1);
    expect(result.workflows[0]!.id).toBe('simple-wf');
  });

  it('handleGetWorkflowProtocol returns protocol for known workflow', async () => {
    const workflowStore = new JsonWorkflowStore(workflowDir);
    await workflowStore.register(makeSimpleDef());

    const result = await handleGetWorkflowProtocol({ workflow_id: 'simple-wf' }, { workflowStore });

    expect(result.workflow_id).toBe('simple-wf');
    expect(result.steps.length).toBe(1);
  });

  it('handleStartRun creates a run and chains auto steps', async () => {
    const workflowStore = new JsonWorkflowStore(workflowDir);
    await workflowStore.register(makeSimpleDef());
    const runStore = new JsonFileStore(runDir);

    const result = await handleStartRun(
      { workflow_id: 'simple-wf', params: {} },
      { runStore, workflowStore },
    );

    expect(result.status).toBe('ok');
    expect(typeof result.run_id).toBe('string');

    const run = await runStore.get(result.run_id);
    expect(run.state).toBe('completed');
  });

  it('handleExecuteStep advances an agent step', async () => {
    const workflowStore = new JsonWorkflowStore(workflowDir);
    await workflowStore.register(makeAgentDef());
    const runStore = new JsonFileStore(runDir);

    // Start run: chains through the auto step, stops at agent step.
    const startResult = await handleStartRun(
      { workflow_id: 'agent-wf', params: {} },
      { runStore, workflowStore },
    );
    expect(startResult.status).toBe('ok');

    // Run is now at state_a waiting for the agent step.
    const midRun = await runStore.get(startResult.run_id);
    expect(midRun.state).toBe('state_a');

    // Agent executes the step.
    const result = await handleExecuteStep(
      { run_id: startResult.run_id, command: 'step-agent', params: { result: 'done' } },
      { runStore, workflowStore },
    );

    expect(result.status).toBe('ok');
    const finalRun = await runStore.get(startResult.run_id);
    expect(finalRun.state).toBe('completed');
  });

  it('handleSubmitHumanResponse advances a gate-waiting run', async () => {
    const workflowStore = new JsonWorkflowStore(workflowDir);
    await workflowStore.register(makeGateDef());
    const runStore = new JsonFileStore(runDir);

    // Start run — chains into the gate step, which opens the gate.
    const startResult = await handleStartRun(
      { workflow_id: 'gate-wf', params: {} },
      { runStore, workflowStore },
    );
    expect(startResult.status).toBe('confirm_required');
    expect(startResult.gate).toBeDefined();

    const gateId = startResult.gate!.gate_id;
    const gateRun = await runStore.get(startResult.run_id);

    const result = await handleSubmitHumanResponse(
      { run_id: startResult.run_id, gate_id: gateId, choice: 'approve' },
      { runStore, workflowStore },
    );

    expect(result.status).toBe('ok');
    const finalRun = await runStore.get(startResult.run_id);
    expect(finalRun.state).toBe('approved');
    // Suppress unused-variable warning for gateRun
    void gateRun;
  });

  it('handleGetRunState returns run summary', async () => {
    const workflowStore = new JsonWorkflowStore(workflowDir);
    await workflowStore.register(makeSimpleDef());
    const runStore = new JsonFileStore(runDir);

    const startResult = await handleStartRun(
      { workflow_id: 'simple-wf' },
      { runStore, workflowStore },
    );

    const state = await handleGetRunState({ run_id: startResult.run_id }, { runStore });

    expect(state.run_id).toBe(startResult.run_id);
    expect(state.state).toBe('completed');
    expect(state.terminal_state).toBe(true);
    expect(typeof state.evidence_count).toBe('number');
  });
});
