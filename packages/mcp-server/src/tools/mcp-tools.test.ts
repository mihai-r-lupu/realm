// Integration tests for MCP tool business logic — tests handle* functions directly.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileStore, JsonWorkflowStore } from '@sensigo/realm';
import type { WorkflowDefinition } from '@sensigo/realm';
import { handleListWorkflows } from './list-workflows.js';
import { handleGetWorkflowProtocol } from './get-workflow-protocol.js';
import { handleStartRun } from './start-run.js';
import { handleExecuteStep, handleExecuteStepTool } from './execute-step.js';
import { handleSubmitHumanResponse } from './submit-human-response.js';
import { handleGetRunState } from './get-run-state.js';
import { createDefaultRegistry } from '../server.js';

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
    expect(result.hint).toContain('get_workflow_protocol');
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
    expect(result.data).toEqual({});
    expect(result.context_hint).toBeDefined();
    expect(result.context_hint).not.toBe('');
    expect(result.chained_auto_steps).toEqual([{ step: 'step-a', produced_state: 'completed' }]);

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
    // The auto step ran silently during start_run — it must be reported.
    expect(startResult.chained_auto_steps).toEqual([{ step: 'step-auto', produced_state: 'state_a' }]);

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

  it('handleExecuteStepTool strips data from the MCP response', async () => {
    const workflowStore = new JsonWorkflowStore(workflowDir);
    await workflowStore.register(makeAgentDef());
    const runStore = new JsonFileStore(runDir);

    // Start run: chains through the auto step, stops at agent step.
    const startResult = await handleStartRun(
      { workflow_id: 'agent-wf', params: {} },
      { runStore, workflowStore },
    );
    expect(startResult.status).toBe('ok');

    // Call the MCP-layer handler (not the raw handleExecuteStep).
    const result = await handleExecuteStepTool(
      { run_id: startResult.run_id, command: 'step-agent', params: { result: 'done' } },
      { runStore, workflowStore },
    );

    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed['data']).toEqual({});
    expect(parsed['status']).toBe('ok');
  });

  it('handleExecuteStepTool returns structured JSON on unexpected catch', async () => {
    // Pass a runStore that throws a plain Error (not WorkflowError) so it bypasses
    // executeStep's internal error handling and propagates to handleExecuteStepTool's catch.
    const throwingOpts = {
      runStore: {
        get: async () => { throw new Error('unexpected failure'); },
        create: async () => { throw new Error('unexpected failure'); },
        update: async () => { throw new Error('unexpected failure'); },
        list: async () => [],
      } as unknown as JsonFileStore,
    };

    const result = await handleExecuteStepTool(
      { run_id: 'test-run', command: 'review_security' },
      throwingOpts,
    );

    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed['status']).toBe('error');
    expect(parsed['agent_action']).toBe('stop');
    expect(parsed['next_action']).toBeNull();
    expect((parsed['errors'] as string[])[0]).toContain('unexpected failure');
    expect(parsed['run_id']).toBe('test-run');
    expect(parsed['command']).toBe('review_security');
  });

  it('handleGetRunState returns run summary', async () => {    const workflowStore = new JsonWorkflowStore(workflowDir);
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

  it('gate on_reject transition: submit_human_response routes to target step', async () => {
    const gateTransitionDef: WorkflowDefinition = {
      id: 'gate-trans-wf',
      name: 'Gate Transition Workflow',
      version: 1,
      initial_state: 'created',
      steps: {
        'review': {
          description: 'Human gate with on_reject',
          execution: 'auto',
          trust: 'human_confirmed',
          allowed_from_states: ['created'],
          produces_state: 'approved',
          gate: { choices: ['approve', 'reject'] },
          transitions: {
            on_reject: { step: 'revise', produces_state: 'revision_needed' },
          },
        },
        'revise': {
          description: 'Agent revision step',
          execution: 'agent',
          allowed_from_states: ['revision_needed'],
          produces_state: 'completed',
        },
      },
    };
    const workflowStore = new JsonWorkflowStore(workflowDir);
    await workflowStore.register(gateTransitionDef);
    const runStore = new JsonFileStore(runDir);

    // Start run — chains into gate step
    const startResult = await handleStartRun(
      { workflow_id: 'gate-trans-wf', params: {} },
      { runStore, workflowStore },
    );
    expect(startResult.status).toBe('confirm_required');
    const gateId = startResult.gate!.gate_id;
    const gateRun = await runStore.get(startResult.run_id);

    // Submit reject
    const rejectResult = await handleSubmitHumanResponse(
      { run_id: startResult.run_id, gate_id: gateId, choice: 'reject' },
      { runStore, workflowStore },
    );

    expect(rejectResult.status).toBe('ok');
    expect(rejectResult.next_action).not.toBeNull();
    expect((rejectResult.next_action!.instruction!.params as Record<string, unknown>)['command']).toBe('revise');
    expect(rejectResult.chained_auto_steps).toBeDefined();
    expect(rejectResult.chained_auto_steps![0]!.branched_via).toBe('on_reject');

    const finalRun = await runStore.get(startResult.run_id);
    expect(finalRun.state).toBe('revision_needed');

    // Suppress unused-variable warning
    void gateRun;
  });

  it('handleStartRun resolves a filesystem auto step using the default built-in registry', async () => {
    // Write a temp file to read.
    const tempFilePath = join(runDir, 'test-input.txt');
    await writeFile(tempFilePath, 'hello from filesystem adapter');

    const filesystemDef: WorkflowDefinition = {
      id: 'filesystem-auto-wf',
      name: 'Filesystem Auto Workflow',
      version: 1,
      initial_state: 'created',
      services: {
        source: { adapter: 'filesystem', trust: 'engine_delivered' },
      },
      steps: {
        read_file: {
          description: 'Read a file from disk.',
          execution: 'auto',
          uses_service: 'source',
          operation: 'read',
          allowed_from_states: ['created'],
          produces_state: 'completed',
        },
      },
    };

    const workflowStore = new JsonWorkflowStore(workflowDir);
    await workflowStore.register(filesystemDef);
    const runStore = new JsonFileStore(runDir);

    // createDefaultRegistry() is what createRealmMcpServer() uses when no registry is provided.
    // Passing it here verifies that the default registry has FileSystemAdapter available.
    const result = await handleStartRun(
      { workflow_id: 'filesystem-auto-wf', params: { path: tempFilePath } },
      { runStore, workflowStore, registry: createDefaultRegistry() },
    );

    expect(result.status).toBe('ok');
    expect(result.chained_auto_steps).toHaveLength(1);
    expect(result.chained_auto_steps![0]!.step).toBe('read_file');
    expect(result.chained_auto_steps![0]!.produced_state).toBe('completed');

    const run = await runStore.get(result.run_id);
    expect(run.state).toBe('completed');
  });
});
