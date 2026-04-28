// Tests for runAgent(), postGateNotificationToSlack(), resolveProvider(), and checkAdapterPrerequisites().
// Uses InMemoryStore and MockLlmProvider to run the agent loop without real I/O.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  InMemoryStore,
} from '@sensigo/realm-testing';
import {
  createDefaultRegistry,
  CURRENT_WORKFLOW_SCHEMA_VERSION,
  submitHumanResponse,
} from '@sensigo/realm';
import type { WorkflowDefinition, WorkflowRegistrar, PendingGate } from '@sensigo/realm';
import { runAgent, postGateNotificationToSlack } from '../agent/run-agent.js';
import type { AgentDeps, AgentRunOptions } from '../agent/run-agent.js';
import type { LlmProvider } from '../agent/llm-provider.js';
import { resolveProvider } from '../agent/llm-provider.js';
import { checkAdapterPrerequisites, formatPreflightError, checkSlackBidirectionalConfig } from '../agent/preflight.js';

// ---------------------------------------------------------------------------
// MockLlmProvider — queue-based: returns responses in order of callStep() calls.
// ---------------------------------------------------------------------------

class MockLlmProvider implements LlmProvider {
  readonly callCount: { value: number } = { value: 0 };
  private readonly responses: Array<Record<string, unknown> | Error>;

  constructor(responses: Array<Record<string, unknown> | Error>) {
    this.responses = responses;
  }

  async callStep(_prompt: string, _schema?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = this.responses[this.callCount.value++];
    if (response instanceof Error) throw response;
    return response ?? {};
  }
}

// ---------------------------------------------------------------------------
// Stub WorkflowRegistrar — no-op register, not needed for test assertions.
// ---------------------------------------------------------------------------

function makeWorkflowStore(): WorkflowRegistrar {
  return {
    async register() { },
    async get() { throw new Error('not used in these tests'); },
    async list() { return []; },
  };
}

// ---------------------------------------------------------------------------
// Workflow definitions used across tests.
// ---------------------------------------------------------------------------

const agentOnlyWorkflow: WorkflowDefinition = {
  id: 'agent-only',
  name: 'Agent Only',
  version: 1,
  schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION,
  steps: {
    summarize: {
      description: 'Summarize the input',
      execution: 'agent',
      input_schema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    },
  },
};

const gateWorkflow: WorkflowDefinition = {
  id: 'gate-wf',
  name: 'Gate Workflow',
  version: 1,
  schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION,
  steps: {
    agent_step: {
      description: 'Agent step before the gate',
      execution: 'agent',
    },
    gate_step: {
      description: 'Human approval gate',
      execution: 'auto',
      trust: 'human_confirmed',
      depends_on: ['agent_step'],
      gate: { choices: ['approve'] },
    },
  },
};

const errorWorkflow: WorkflowDefinition = {
  id: 'error-wf',
  name: 'Error Workflow',
  version: 1,
  schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION,
  // No services section — 'broken' service will not resolve.
  steps: {
    broken_step: {
      description: 'Step that calls a missing service',
      execution: 'auto',
      uses_service: 'broken',
      service_method: 'fetch',
      operation: 'anything',
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<AgentDeps> = {}): AgentDeps & { store: InMemoryStore } {
  const store = new InMemoryStore();
  return {
    store,
    workflowStore: makeWorkflowStore(),
    provider: new MockLlmProvider([]),
    registry: createDefaultRegistry(),
    ...overrides,
  };
}

function makeOptions(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return { params: {}, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAgent', () => {
  it('returns completed when all agent steps resolve', async () => {
    const deps = makeDeps({ provider: new MockLlmProvider([{ summary: 'all good' }]) });

    const result = await runAgent(deps, makeOptions({ definition: agentOnlyWorkflow }));

    expect(result).toBe('completed');
  });

  it('retries the LLM call once then returns failed when both attempts throw', async () => {
    const provider = new MockLlmProvider([
      new Error('bad JSON'),
      new Error('bad JSON again'),
    ]);
    const deps = makeDeps({ provider });

    const result = await runAgent(deps, makeOptions({ definition: agentOnlyWorkflow }));

    expect(result).toBe('failed');
    expect(provider.callCount.value).toBe(2);
  });

  it('succeeds when the LLM call fails on the first attempt but succeeds on the second', async () => {
    const provider = new MockLlmProvider([
      new Error('transient error'),
      { summary: 'recovered' },
    ]);
    const deps = makeDeps({ provider });

    const result = await runAgent(deps, makeOptions({ definition: agentOnlyWorkflow }));

    expect(result).toBe('completed');
    expect(provider.callCount.value).toBe(2);
  });

  it('pauses at a gate and continues after the onGate hook resolves it', async () => {
    const provider = new MockLlmProvider([{ output: 'step done' }]);
    const onGate = vi.fn().mockImplementation(
      async (runId: string, gate: PendingGate) => {
        const run = await deps.store.get(runId);
        await submitHumanResponse(deps.store, gateWorkflow, {
          runId,
          gateId: gate.gate_id,
          choice: 'approve',
        });
        void run; // keep TS happy
      },
    );
    const deps = makeDeps({ provider, onGate });

    const result = await runAgent(deps, makeOptions({ definition: gateWorkflow }));

    expect(result).toBe('completed');
    expect(onGate).toHaveBeenCalledOnce();
  });

  it('returns failed when executeChain returns status: error', async () => {
    const deps = makeDeps();

    const result = await runAgent(deps, makeOptions({ definition: errorWorkflow }));

    expect(result).toBe('failed');
  });

  it('throws when the workflow file does not exist', async () => {
    const deps = makeDeps();

    await expect(
      runAgent(deps, makeOptions({ workflowPath: '/nonexistent/path/workflow.yaml' })),
    ).rejects.toThrow();
  });
});

describe('resolveProvider', () => {
  let savedOpenAI: string | undefined;
  let savedAnthropic: string | undefined;

  beforeEach(() => {
    savedOpenAI = process.env['OPENAI_API_KEY'];
    savedAnthropic = process.env['ANTHROPIC_API_KEY'];
  });

  afterEach(() => {
    // Restore original values so local developers with real keys are unaffected.
    if (savedOpenAI === undefined) {
      delete process.env['OPENAI_API_KEY'];
    } else {
      process.env['OPENAI_API_KEY'] = savedOpenAI;
    }
    if (savedAnthropic === undefined) {
      delete process.env['ANTHROPIC_API_KEY'];
    } else {
      process.env['ANTHROPIC_API_KEY'] = savedAnthropic;
    }
  });

  it('throws when neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set', async () => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];

    await expect(resolveProvider(undefined, undefined)).rejects.toThrow(
      'realm agent requires an LLM API key',
    );
  });
});

describe('postGateNotificationToSlack', () => {
  it('posts the correct request body to the webhook URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const gate: PendingGate = {
      gate_id: 'gate-001',
      step_name: 'human_review',
      preview: { title: 'My PR' },
      choices: ['approve'],
      opened_at: new Date().toISOString(),
    };
    await postGateNotificationToSlack('https://hooks.slack.com/test', gate, 'realm run respond abc --gate gate-001 --choice approve');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.slack.com/test');
    const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
    expect(body.text).toContain('gate');
    expect(JSON.stringify(body.blocks)).toContain('human_review');
    expect(JSON.stringify(body.blocks)).toContain('realm run respond abc');

    vi.unstubAllGlobals();
  });

  it('swallows network errors without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const gate: PendingGate = {
      gate_id: 'g1',
      step_name: 's1',
      preview: {},
      choices: ['approve'],
      opened_at: new Date().toISOString(),
    };
    await expect(
      postGateNotificationToSlack('https://hooks.slack.com/test', gate, 'cmd'),
    ).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Workflow definitions for preflight tests.
// ---------------------------------------------------------------------------

const githubWorkflow: WorkflowDefinition = {
  id: 'github-wf',
  name: 'GitHub Workflow',
  version: 1,
  schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION,
  services: {
    github: { adapter: 'github', trust: 'engine_delivered' },
  },
  steps: {
    fetch: { description: 'Fetch', execution: 'auto', uses_service: 'github', service_method: 'fetch', operation: 'get_pr_diff' },
  },
};

const slackWorkflow: WorkflowDefinition = {
  id: 'slack-wf',
  name: 'Slack Workflow',
  version: 1,
  schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION,
  services: {
    notifications: { adapter: 'slack', trust: 'engine_delivered' },
  },
  steps: {
    notify: { description: 'Notify', execution: 'auto', uses_service: 'notifications', service_method: 'create', operation: 'post_message' },
  },
};

const bothAdaptersWorkflow: WorkflowDefinition = {
  id: 'both-wf',
  name: 'Both Adapters',
  version: 1,
  schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION,
  services: {
    github: { adapter: 'github', trust: 'engine_delivered' },
    notifications: { adapter: 'slack', trust: 'engine_delivered' },
  },
  steps: {
    fetch: { description: 'Fetch', execution: 'auto', uses_service: 'github', service_method: 'fetch', operation: 'get_pr_diff' },
  },
};

describe('checkAdapterPrerequisites', () => {
  it('returns a finding when the workflow uses adapter: github and GITHUB_TOKEN is missing', () => {
    const findings = checkAdapterPrerequisites(githubWorkflow, {});
    expect(findings).toHaveLength(1);
    expect(findings[0]!.serviceName).toBe('github');
    expect(findings[0]!.adapter).toBe('github');
    expect(findings[0]!.missingVar).toBe('GITHUB_TOKEN');
  });

  it('returns a finding when the workflow uses adapter: slack and SLACK_WEBHOOK_URL is missing', () => {
    const findings = checkAdapterPrerequisites(slackWorkflow, {});
    expect(findings).toHaveLength(1);
    expect(findings[0]!.serviceName).toBe('notifications');
    expect(findings[0]!.adapter).toBe('slack');
    expect(findings[0]!.missingVar).toBe('SLACK_WEBHOOK_URL');
  });

  it('returns no findings when both required vars are set', () => {
    const findings = checkAdapterPrerequisites(bothAdaptersWorkflow, {
      GITHUB_TOKEN: 'ghp_test',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test',
    });
    expect(findings).toHaveLength(0);
  });

  it('returns no findings for workflows with no external adapter services', () => {
    const findings = checkAdapterPrerequisites(agentOnlyWorkflow, {});
    expect(findings).toHaveLength(0);
  });

  it('formatPreflightError includes service name, adapter name, and export guidance', () => {
    const findings = checkAdapterPrerequisites(githubWorkflow, {});
    const msg = formatPreflightError(findings);
    expect(msg).toContain("service 'github'");
    expect(msg).toContain("adapter 'github'");
    expect(msg).toContain('GITHUB_TOKEN');
    expect(msg).toContain('export GITHUB_TOKEN=');
  });
});

describe('checkSlackBidirectionalConfig', () => {
  it('warns when SLACK_WEBHOOK_URL is set but SLACK_BOT_TOKEN is absent', () => {
    const warnings = checkSlackBidirectionalConfig({ SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('SLACK_WEBHOOK_URL');
    expect(warnings[0]!.message).toContain('SLACK_BOT_TOKEN');
  });

  it('warns when SLACK_BOT_TOKEN is set but SLACK_SIGNING_SECRET is absent', () => {
    const warnings = checkSlackBidirectionalConfig({ SLACK_BOT_TOKEN: 'xoxb-test' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('SLACK_BOT_TOKEN');
    expect(warnings[0]!.message).toContain('SLACK_SIGNING_SECRET');
  });

  it('returns no warnings when SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are both set', () => {
    const warnings = checkSlackBidirectionalConfig({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_SIGNING_SECRET: 'secret',
    });
    expect(warnings).toHaveLength(0);
  });

  it('returns no warnings when no Slack vars are set', () => {
    expect(checkSlackBidirectionalConfig({})).toHaveLength(0);
  });
});
