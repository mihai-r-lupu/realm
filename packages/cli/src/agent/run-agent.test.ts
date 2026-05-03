// run-agent.test.ts — Tests for formatGatePreviewForSlack, owner Slack notification,
// startGateReminderTimers, postSlackReply, bidirectional gate handling, and MCP tool dispatch.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatGatePreviewForSlack,
  postGateNotificationToSlack,
  postGateViaApi,
  startGateReminderTimers,
  postSlackReply,
  handleBidirectionalGate,
  runAgent,
} from './run-agent.js';
import type { BidirectionalGateParams, AgentDeps } from './run-agent.js';
import type { PendingGate, RunStore, WorkflowDefinition, ToolCallRecord } from '@sensigo/realm';
import { CURRENT_WORKFLOW_SCHEMA_VERSION, createDefaultRegistry } from '@sensigo/realm';
import { InMemoryStore } from '@sensigo/realm-testing';
import type { LlmProvider } from './llm-provider.js';
import type { McpClient, McpTool, McpServerConfig } from './mcp-types.js';
import { startSlackGateServer } from './slack-gate-server.js';
import type { SlackGateEvent } from './slack-gate-server.js';
import { connectSocketMode } from './slack-socket-client.js';

// Module-level mocks are hoisted by vitest — run-agent.ts will receive these stubs for its
// internal imports of slack-gate-server and slack-socket-client.
vi.mock('./slack-gate-server.js', () => ({
  startSlackGateServer: vi.fn().mockReturnValue({ close: vi.fn() }),
}));
vi.mock('./slack-socket-client.js', () => ({
  connectSocketMode: vi.fn().mockReturnValue({ close: vi.fn() }),
}));

describe('formatGatePreviewForSlack', () => {
  it('renders headline and message as formatted mrkdwn', () => {
    const preview = { headline: 'Deploy failed', message: 'The pipeline failed at step 3.' };
    const result = formatGatePreviewForSlack(preview);
    expect(result).toBe('*Deploy failed*\n\nThe pipeline failed at step 3.');
  });

  it('renders only headline when message is absent', () => {
    const preview = { headline: 'Deploy failed' };
    const result = formatGatePreviewForSlack(preview);
    expect(result).toBe('*Deploy failed*');
    expect(result).not.toContain('undefined');
  });

  it('falls back to formatted multi-line JSON when neither headline nor message is present', () => {
    const preview = { risk: 'high', title: 'Add feature' };
    const result = formatGatePreviewForSlack(preview);
    // Multi-line formatted JSON — not a single-line stringify
    expect(result).toContain('\n');
    expect(result).toContain('risk');
    expect(result).not.toBe(JSON.stringify(preview));
  });

  it('handles empty preview without throwing', () => {
    expect(() => formatGatePreviewForSlack({})).not.toThrow();
  });
});

describe('postGateNotificationToSlack — owner field', () => {
  it('uses resolved_message when present instead of formatGatePreviewForSlack fallback', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const gate: PendingGate = {
      gate_id: 'g0',
      step_name: 'human_review',
      preview: { headline: 'Draft', message: 'Body text' },
      choices: ['approve'],
      opened_at: new Date().toISOString(),
      resolved_message: 'Approve this draft?',
    };
    await postGateNotificationToSlack(
      'https://hooks.slack.com/test',
      gate,
      'realm run respond r1 --gate g0 --choice approve',
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const bodyStr = init.body as string;
    expect(bodyStr).toContain('Approve this draft?');
    // The fallback formatGatePreviewForSlack headline must NOT be used.
    expect(bodyStr).not.toContain('*Draft*');

    vi.unstubAllGlobals();
  });

  it('falls back to formatGatePreviewForSlack when resolved_message is absent', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const gate: PendingGate = {
      gate_id: 'g0b',
      step_name: 'human_review',
      preview: { headline: 'Draft', message: 'Body text' },
      choices: ['approve'],
      opened_at: new Date().toISOString(),
      // no resolved_message
    };
    await postGateNotificationToSlack(
      'https://hooks.slack.com/test',
      gate,
      'realm run respond r1 --gate g0b --choice approve',
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const bodyStr = init.body as string;
    // formatGatePreviewForSlack produces *Draft* for headline
    expect(bodyStr).toContain('*Draft*');
    expect(bodyStr).not.toContain('undefined');

    vi.unstubAllGlobals();
  });

  it('includes *Owner:* line when gate.owner is set', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const gate: PendingGate = {
      gate_id: 'g1',
      step_name: 'human_review',
      preview: { headline: 'My PR' },
      choices: ['approve'],
      opened_at: new Date().toISOString(),
      owner: '@mihai.lupu',
    };
    await postGateNotificationToSlack(
      'https://hooks.slack.com/test',
      gate,
      'realm run respond r1 --gate g1 --choice approve',
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { blocks: unknown[] };
    expect(JSON.stringify(body.blocks)).toContain('*Owner:*');
    expect(JSON.stringify(body.blocks)).toContain('@mihai.lupu');

    vi.unstubAllGlobals();
  });

  it('omits *Owner:* line when gate.owner is absent', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const gate: PendingGate = {
      gate_id: 'g2',
      step_name: 'human_review',
      preview: { headline: 'My PR' },
      choices: ['approve'],
      opened_at: new Date().toISOString(),
    };
    await postGateNotificationToSlack(
      'https://hooks.slack.com/test',
      gate,
      'realm run respond r1 --gate g2 --choice approve',
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { blocks: unknown[] };
    expect(JSON.stringify(body.blocks)).not.toContain('*Owner:*');

    vi.unstubAllGlobals();
  });
});

describe('postGateViaApi — resolved_message', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses resolved_message when present instead of formatGatePreviewForSlack fallback', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ts: '1234567890.000' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const gate: PendingGate = {
      gate_id: 'gv1',
      step_name: 'review_step',
      preview: { headline: 'Draft headline' },
      choices: ['send', 'reject'],
      opened_at: new Date().toISOString(),
      resolved_message: 'Approve this draft?',
    };
    await postGateViaApi(
      'xoxb-test',
      'C123',
      gate,
      'realm run respond r1 --gate gv1 --choice send',
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const bodyStr = init.body as string;
    expect(bodyStr).toContain('Approve this draft?');
    expect(bodyStr).not.toContain('*Draft headline*');
  });

  it('falls back to formatGatePreviewForSlack when resolved_message is absent', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ts: '1234567890.001' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const gate: PendingGate = {
      gate_id: 'gv2',
      step_name: 'review_step',
      preview: { headline: 'Draft headline' },
      choices: ['send', 'reject'],
      opened_at: new Date().toISOString(),
      // no resolved_message
    };
    await postGateViaApi(
      'xoxb-test',
      'C123',
      gate,
      'realm run respond r1 --gate gv2 --choice send',
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const bodyStr = init.body as string;
    expect(bodyStr).toContain('*Draft headline*');
    expect(bodyStr).not.toContain('undefined');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGate(overrides: Partial<PendingGate> = {}): PendingGate {
  return {
    gate_id: 'g1',
    step_name: 'review_step',
    preview: { headline: 'Deploy v2.0' },
    choices: ['approve', 'reject'],
    opened_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// startGateReminderTimers
// ---------------------------------------------------------------------------

describe('startGateReminderTimers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('posts reminder text at the configured interval', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { text: string };
        calls.push(body.text);
        return Promise.resolve({ json: async () => ({ ok: true }) });
      }),
    );

    const gate = makeGate({ step_name: 'review_step' });
    const clearTimers = startGateReminderTimers(
      'xoxb-test',
      'C123',
      '1234567890.000',
      gate,
      500, // reminderIntervalMs
      5000, // escalationThresholdMs
    );

    await vi.advanceTimersByTimeAsync(600);
    clearTimers();

    expect(calls.some((t) => t.includes('review_step') && t.includes('Reminder'))).toBe(true);
  });

  it('includes owner mention in escalation message when gate.owner is set', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { text: string };
        calls.push(body.text);
        return Promise.resolve({ json: async () => ({ ok: true }) });
      }),
    );

    const gate = makeGate({ step_name: 'review_step', owner: '@prod-oncall' });
    const clearTimers = startGateReminderTimers(
      'xoxb-test',
      'C123',
      '1234567890.000',
      gate,
      10, // reminderIntervalMs — fires fast
      20, // escalationThresholdMs — fires even faster for escalation
    );

    await vi.advanceTimersByTimeAsync(50);
    clearTimers();

    const escalationMsg = calls.find((t) => t.includes('review_step') && t.includes('minutes'));
    expect(escalationMsg).toBeDefined();
    expect(escalationMsg).toContain('@prod-oncall');
  });

  it('posts generic escalation message (no @ mention) when gate.owner is absent', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { text: string };
        calls.push(body.text);
        return Promise.resolve({ json: async () => ({ ok: true }) });
      }),
    );

    const gate = makeGate({ step_name: 'review_step' }); // no owner
    const clearTimers = startGateReminderTimers(
      'xoxb-test',
      'C123',
      '1234567890.000',
      gate,
      10,
      20,
    );

    await vi.advanceTimersByTimeAsync(50);
    clearTimers();

    const escalationMsg = calls.find((t) => t.includes('review_step') && t.includes('minutes'));
    expect(escalationMsg).toBeDefined();
    // No @ mention without owner
    expect(escalationMsg).not.toContain('@');
  });

  it('does not fire after clearTimers() is called', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', mockFetch);

    const gate = makeGate();
    const clearTimers = startGateReminderTimers(
      'xoxb-test',
      'C123',
      '1234567890.000',
      gate,
      200,
      400,
    );

    // Clear before any timers fire.
    clearTimers();
    await vi.advanceTimersByTimeAsync(600);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// postSlackReply
// ---------------------------------------------------------------------------

describe('postSlackReply', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not throw when the fetch call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Should not throw — postSlackReply is best-effort.
    await expect(
      postSlackReply('xoxb-test', 'C123', '1234567890.000', 'Hello'),
    ).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// handleBidirectionalGate
// ---------------------------------------------------------------------------

function makeMinimalStore(): RunStore {
  return {
    get: vi.fn().mockResolvedValue({ terminal_state: 'completed', pending_gate: undefined }),
  } as unknown as RunStore;
}

/**
 * Store that mimics a gate-waiting run for the first get() call, then returns
 * completed. Includes a patch() stub so submitHumanResponse can write evidence.
 */
function makeGateStore(gate: PendingGate): RunStore {
  const completedRun = {
    id: 'run1',
    terminal_state: 'completed',
    pending_gate: undefined,
    run_phase: 'completed',
    version: 2,
    in_progress_steps: [],
    completed_steps: [gate.step_name],
    skipped_steps: [],
    evidence: [],
  };
  const openRun = {
    id: 'run1',
    terminal_state: undefined,
    pending_gate: gate,
    run_phase: 'waiting_for_human',
    version: 1,
    in_progress_steps: [gate.step_name],
    completed_steps: [],
    skipped_steps: [],
    evidence: [],
  };
  const get = vi.fn().mockResolvedValueOnce(openRun).mockResolvedValue(completedRun);
  const update = vi.fn().mockResolvedValue(completedRun);
  return { get, update } as unknown as RunStore;
}

function makeMinimalDefinition(): WorkflowDefinition {
  return { id: 'wf1', name: 'Test WF', version: '1', steps: {} } as unknown as WorkflowDefinition;
}

function makeGateParams(overrides: Partial<BidirectionalGateParams> = {}): BidirectionalGateParams {
  return {
    gate: {
      gate_id: 'g1',
      step_name: 'review_step',
      preview: { headline: 'Deploy v2.0' },
      choices: ['approve', 'reject'],
      opened_at: new Date().toISOString(),
    },
    runId: 'run1',
    definition: makeMinimalDefinition(),
    store: makeMinimalStore(),
    provider: { callStep: vi.fn() } as unknown as LlmProvider,
    slackBotToken: 'xoxb-test',
    slackChannelId: 'C123',
    gateThreadTs: '1234567890.000',
    slackSigningSecret: 'secret',
    slackEventsPort: 3100,
    gateReminderIntervalMs: 999_999,
    gateEscalationThresholdMs: 999_999,
    pollIntervalMs: 0,
    ...overrides,
  };
}

describe('handleBidirectionalGate', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not start Events server when gateThreadTs is undefined', async () => {
    await handleBidirectionalGate(makeGateParams({ gateThreadTs: undefined }));

    expect(startSlackGateServer).not.toHaveBeenCalled();
  });

  it('emits fallback notice when gateThreadTs is undefined', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleBidirectionalGate(makeGateParams({ gateThreadTs: undefined }));

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Bidirectional Slack resolution unavailable');

    logSpy.mockRestore();
  });

  it('duplicate event_id triggers only one candidate processing attempt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    let capturedOnEvent: ((event: SlackGateEvent) => void) | undefined;
    vi.mocked(startSlackGateServer).mockImplementationOnce((opts) => {
      capturedOnEvent = opts.onEvent;
      return { close: vi.fn() };
    });

    // Use a fetch spy to count how many clarification replies are sent.
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);

    const promise = handleBidirectionalGate(makeGateParams());

    // startSlackGateServer ran synchronously before the first await — onEvent captured.
    expect(capturedOnEvent).toBeDefined();

    const event: SlackGateEvent = {
      event_id: 'Ev001',
      thread_ts: '1234567890.000',
      user: 'U1',
      text: 'maybe approve', // not an exact choice — triggers one clarification reply
      ts: '1234567890.001',
    };

    capturedOnEvent!(event); // first delivery
    capturedOnEvent!(event); // duplicate — must be ignored

    await new Promise<void>((r) => setTimeout(r, 50));
    await promise;

    // Only one clarification reply should have been sent (dedupe is working).
    const replyCalls = fetchSpy.mock.calls.filter(([url]: [string]) =>
      (url as string).includes('postMessage'),
    );
    expect(replyCalls).toHaveLength(1);
  });

  it('selects Socket Mode (connectSocketMode) when slackAppToken is set and slackSigningSecret is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    await handleBidirectionalGate(
      makeGateParams({ slackSigningSecret: undefined, slackAppToken: 'xapp-test' }),
    );

    expect(connectSocketMode).toHaveBeenCalledOnce();
    expect(startSlackGateServer).not.toHaveBeenCalled();
  });

  it('selects Socket Mode over Events API when both slackAppToken and slackSigningSecret are set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    await handleBidirectionalGate(
      makeGateParams({ slackSigningSecret: 'secret', slackAppToken: 'xapp-test' }),
    );

    expect(connectSocketMode).toHaveBeenCalledOnce();
    expect(startSlackGateServer).not.toHaveBeenCalled();
  });

  it('exact match resolves gate and posts confirmation reply', async () => {
    const gate: PendingGate = {
      gate_id: 'g1',
      step_name: 'confirm_review',
      preview: { headline: 'PR #42' },
      choices: ['approve', 'request_changes'],
      opened_at: new Date().toISOString(),
    };
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    let capturedOnEvent: ((event: SlackGateEvent) => void) | undefined;
    vi.mocked(startSlackGateServer).mockImplementationOnce((opts) => {
      capturedOnEvent = opts.onEvent;
      return { close: vi.fn() };
    });

    const promise = handleBidirectionalGate(makeGateParams({ gate, store: makeGateStore(gate) }));
    expect(capturedOnEvent).toBeDefined();

    capturedOnEvent!({
      event_id: 'E1',
      thread_ts: '1234567890.000',
      user: 'U1',
      text: 'approve',
      ts: '1234567890.001',
    });

    await promise;

    const replyCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes('postMessage'),
    );
    expect(replyCalls.length).toBeGreaterThan(0);
    const replyBody = JSON.parse(replyCalls[replyCalls.length - 1][1].body as string) as {
      text: string;
    };
    expect(replyBody.text).toContain('approve');
  });

  it('non-exact input sends a clarification reply listing valid choices', async () => {
    const gate: PendingGate = {
      gate_id: 'g1',
      step_name: 'confirm_review',
      preview: { headline: 'PR #42' },
      choices: ['approve', 'request_changes'],
      opened_at: new Date().toISOString(),
    };
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    let capturedOnEvent: ((event: SlackGateEvent) => void) | undefined;
    vi.mocked(startSlackGateServer).mockImplementationOnce((opts) => {
      capturedOnEvent = opts.onEvent;
      return { close: vi.fn() };
    });

    const promise = handleBidirectionalGate(makeGateParams({ gate }));
    expect(capturedOnEvent).toBeDefined();

    // 'reject' is not a valid choice — gate must not be resolved
    capturedOnEvent!({
      event_id: 'E2',
      thread_ts: '1234567890.000',
      user: 'U1',
      text: 'reject',
      ts: '1234567890.002',
    });

    await new Promise<void>((r) => setTimeout(r, 50));
    await promise;

    const replyCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes('postMessage'),
    );
    expect(replyCalls.length).toBeGreaterThan(0);
    const replyBody = JSON.parse(replyCalls[replyCalls.length - 1][1].body as string) as {
      text: string;
    };
    expect(replyBody.text).toContain('approve');
    expect(replyBody.text).toContain('request_changes');
    // Must not silently resolve with a guessed choice
    expect(replyBody.text).not.toContain('Changes requested');
    expect(replyBody.text).not.toContain('Gate resolved');
  });
});

// ---------------------------------------------------------------------------
// MCP tools integration tests
// ---------------------------------------------------------------------------

const mcpWorkflow: WorkflowDefinition = {
  id: 'mcp-wf',
  name: 'MCP Workflow',
  version: 1,
  schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION,
  mcp_servers: [{ id: 'github', command: 'npx', args: ['-y', 'mcp-github'] }],
  steps: {
    research: {
      description: 'Research step with tools',
      execution: 'agent',
      tools: ['github:get_pull_request'],
      max_tool_calls: 5,
      tool_timeout: 10,
      input_schema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    },
  },
};

function makeMockMcpClient(overrides: Partial<McpClient> = {}): McpClient & {
  capturedServerId: string[];
  capturedToolName: string[];
  disconnectCount: number;
} {
  const capturedServerId: string[] = [];
  const capturedToolName: string[] = [];
  let disconnectCount = 0;
  return {
    async connect() {},
    async getTools(serverId: string, allowList: string[]): Promise<McpTool[]> {
      return allowList.map((name) => ({
        name,
        description: `Tool ${name}`,
        inputSchema: { type: 'object' },
      }));
    },
    async call(serverId: string, toolName: string, _args: Record<string, unknown>) {
      capturedServerId.push(serverId);
      capturedToolName.push(toolName);
      return { result: 'ok' };
    },
    async disconnect() {
      disconnectCount++;
    },
    capturedServerId,
    capturedToolName,
    get disconnectCount() {
      return disconnectCount;
    },
    ...overrides,
  };
}

function makeWorkflowStore(def?: WorkflowDefinition) {
  return {
    async register() {},
    async get() {
      if (def) return def;
      throw new Error('not used');
    },
    async list() {
      return def ? [def] : [];
    },
  };
}

describe('runAgent — MCP tools integration', () => {
  it('tool calls dispatched to the correct server and tool name', async () => {
    const mockClient = makeMockMcpClient();
    const toolCalls: ToolCallRecord[] = [
      {
        tool: 'get_pull_request',
        server_id: 'github',
        args: { pr: 1 },
        result: 'PR data',
        duration_ms: 50,
        started_at: new Date().toISOString(),
      },
    ];
    const provider: LlmProvider = {
      callStep: vi.fn(),
      callStepWithTools: vi.fn().mockResolvedValue({ output: { summary: 'done' }, toolCalls }),
    };
    const store = new InMemoryStore();
    const deps: AgentDeps = {
      store,
      workflowStore: makeWorkflowStore(mcpWorkflow),
      provider,
      registry: createDefaultRegistry(),
      mcpClientFactory: () => mockClient,
    };

    await runAgent(deps, { definition: mcpWorkflow, params: {} });

    expect(provider.callStepWithTools).toHaveBeenCalledOnce();
    const [, toolDefs] = (provider.callStepWithTools as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      Array<{ id: string; serverId: string; name: string }>,
    ];
    expect(toolDefs).toHaveLength(1);
    expect(toolDefs[0]!.id).toBe('github:get_pull_request');
    expect(toolDefs[0]!.serverId).toBe('github');
    expect(toolDefs[0]!.name).toBe('get_pull_request');
  });

  it('toolCalls appear in the run evidence snapshot after the step completes', async () => {
    const mockClient = makeMockMcpClient();
    const toolCalls: ToolCallRecord[] = [
      {
        tool: 'get_pull_request',
        server_id: 'github',
        args: { pr: 42 },
        result: 'PR body',
        duration_ms: 100,
        started_at: new Date().toISOString(),
      },
    ];
    const provider: LlmProvider = {
      callStep: vi.fn(),
      callStepWithTools: vi.fn().mockResolvedValue({ output: { summary: 'analysed' }, toolCalls }),
    };
    const store = new InMemoryStore();
    const deps: AgentDeps = {
      store,
      workflowStore: makeWorkflowStore(mcpWorkflow),
      provider,
      registry: createDefaultRegistry(),
      mcpClientFactory: () => mockClient,
    };

    await runAgent(deps, { definition: mcpWorkflow, params: {} });

    const runs = await store.list();
    const run = runs[0]!;
    const snap = run.evidence.find((e) => e.step_id === 'research');
    expect(snap).toBeDefined();
    expect(snap!.tool_calls).toHaveLength(1);
    expect(snap!.tool_calls![0]!.tool).toBe('get_pull_request');
    expect(snap!.tool_calls![0]!.server_id).toBe('github');
  });

  it('disconnect() called on normal completion', async () => {
    const mockClient = makeMockMcpClient();
    const provider: LlmProvider = {
      callStep: vi.fn(),
      callStepWithTools: vi.fn().mockResolvedValue({ output: { summary: 'done' }, toolCalls: [] }),
    };
    const store = new InMemoryStore();
    const deps: AgentDeps = {
      store,
      workflowStore: makeWorkflowStore(mcpWorkflow),
      provider,
      registry: createDefaultRegistry(),
      mcpClientFactory: () => mockClient,
    };

    const result = await runAgent(deps, { definition: mcpWorkflow, params: {} });

    expect(result).toBe('completed');
    expect(mockClient.disconnectCount).toBe(1);
  });

  it('disconnect() called on step failure (callStepWithTools throws)', async () => {
    const mockClient = makeMockMcpClient();
    const provider: LlmProvider = {
      callStep: vi.fn(),
      callStepWithTools: vi.fn().mockRejectedValue(new Error('LLM crashed')),
    };
    const store = new InMemoryStore();
    const deps: AgentDeps = {
      store,
      workflowStore: makeWorkflowStore(mcpWorkflow),
      provider,
      registry: createDefaultRegistry(),
      mcpClientFactory: () => mockClient,
    };

    const result = await runAgent(deps, { definition: mcpWorkflow, params: {} });

    expect(result).toBe('failed');
    expect(mockClient.disconnectCount).toBe(1);
  });

  it('undeclared tool name → console.warn emitted; run proceeds with remaining tools', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockClient = makeMockMcpClient({
      // getTools returns nothing — simulating a server that does not know the tool
      async getTools(): Promise<McpTool[]> {
        return [];
      },
    });
    const provider: LlmProvider = {
      callStep: vi.fn(),
      callStepWithTools: vi
        .fn()
        .mockResolvedValue({ output: { summary: 'done anyway' }, toolCalls: [] }),
    };
    const store = new InMemoryStore();
    const deps: AgentDeps = {
      store,
      workflowStore: makeWorkflowStore(mcpWorkflow),
      provider,
      registry: createDefaultRegistry(),
      mcpClientFactory: () => mockClient,
    };

    const result = await runAgent(deps, { definition: mcpWorkflow, params: {} });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('get_pull_request'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    expect(result).toBe('completed');
    warnSpy.mockRestore();
  });

  it('--run-id attaches to a persisted run and drives it to completion', async () => {
    // Create the run first using the normal path.
    const store = new InMemoryStore();
    const initialRecord = await store.create({
      workflowId: 'agent-only',
      workflowVersion: 1,
      params: {},
    });
    const runId = initialRecord.id;

    const simpleWorkflow: WorkflowDefinition = {
      id: 'agent-only',
      name: 'Agent Only',
      version: 1,
      schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION,
      steps: {
        summarize: {
          description: 'Summarize',
          execution: 'agent',
          input_schema: {
            type: 'object',
            properties: { summary: { type: 'string' } },
            required: ['summary'],
          },
        },
      },
    };

    const provider: LlmProvider = {
      callStep: vi.fn().mockResolvedValue({ summary: 'all good' }),
    };
    const deps: AgentDeps = {
      store,
      workflowStore: makeWorkflowStore(simpleWorkflow),
      provider,
      registry: createDefaultRegistry(),
    };

    const result = await runAgent(deps, {
      existingRunId: runId,
      definition: simpleWorkflow,
      params: {},
    });

    expect(result).toBe('completed');
    const run = await store.get(runId);
    expect(run.terminal_state).toBe(true);
    expect(run.run_phase).toBe('completed');
  });

  it('--run-id on a terminal run throws error containing run id and terminal state', async () => {
    const store = new InMemoryStore();
    const initialRecord = await store.create({
      workflowId: 'agent-only',
      workflowVersion: 1,
      params: {},
    });
    const runId = initialRecord.id;

    // Force the run into terminal state by completing it manually.
    const simpleWorkflow: WorkflowDefinition = {
      id: 'agent-only',
      name: 'Agent Only',
      version: 1,
      schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION,
      steps: {
        summarize: {
          description: 'Summarize',
          execution: 'agent',
          input_schema: {
            type: 'object',
            properties: { summary: { type: 'string' } },
            required: ['summary'],
          },
        },
      },
    };
    const provider: LlmProvider = { callStep: vi.fn().mockResolvedValue({ summary: 'done' }) };
    const deps: AgentDeps = {
      store,
      workflowStore: makeWorkflowStore(simpleWorkflow),
      provider,
      registry: createDefaultRegistry(),
    };
    // First run to completion
    await runAgent(deps, { existingRunId: runId, definition: simpleWorkflow, params: {} });

    // Now try to attach again — run is terminal
    await expect(
      runAgent(deps, { existingRunId: runId, definition: simpleWorkflow, params: {} }),
    ).rejects.toThrow(runId);
  });

  it('existingRunId and workflowPath are mutually exclusive — throws immediately', async () => {
    const store = new InMemoryStore();
    const deps: AgentDeps = {
      store,
      workflowStore: makeWorkflowStore(),
      provider: { callStep: vi.fn() },
      registry: createDefaultRegistry(),
    };

    await expect(
      runAgent(deps, {
        existingRunId: 'some-run-id',
        workflowPath: '/some/path',
        params: {},
      }),
    ).rejects.toThrow('mutually exclusive');
  });
});
