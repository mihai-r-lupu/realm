// run-agent.test.ts — Tests for formatGatePreviewForSlack, owner Slack notification,
// startGateReminderTimers, postSlackReply, and bidirectional gate handling.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatGatePreviewForSlack,
  postGateNotificationToSlack,
  postGateViaApi,
  startGateReminderTimers,
  postSlackReply,
  handleBidirectionalGate,
} from './run-agent.js';
import type { BidirectionalGateParams } from './run-agent.js';
import type { PendingGate, RunStore, WorkflowDefinition } from '@sensigo/realm';
import type { LlmProvider } from './llm-provider.js';
import { startSlackGateServer } from './slack-gate-server.js';
import type { SlackGateEvent } from './slack-gate-server.js';
import { connectSocketMode } from './slack-socket-client.js';
import { interpretGateIntent } from './gate-intent-interpreter.js';

// Module-level mocks are hoisted by vitest — run-agent.ts will receive these stubs for its
// internal imports of slack-gate-server, slack-socket-client, and gate-intent-interpreter.
vi.mock('./slack-gate-server.js', () => ({
  startSlackGateServer: vi.fn().mockReturnValue({ close: vi.fn() }),
}));
vi.mock('./slack-socket-client.js', () => ({
  connectSocketMode: vi.fn().mockReturnValue({ close: vi.fn() }),
}));
vi.mock('./gate-intent-interpreter.js', () => ({
  interpretGateIntent: vi.fn(),
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
    vi.mocked(interpretGateIntent).mockResolvedValue({
      choice: 'unclear',
      confidence: 'low',
      reason: 'ambiguous',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    let capturedOnEvent: ((event: SlackGateEvent) => void) | undefined;
    vi.mocked(startSlackGateServer).mockImplementationOnce((opts) => {
      capturedOnEvent = opts.onEvent;
      return { close: vi.fn() };
    });

    const promise = handleBidirectionalGate(makeGateParams());

    // startSlackGateServer ran synchronously before the first await — onEvent captured.
    expect(capturedOnEvent).toBeDefined();

    const event: SlackGateEvent = {
      event_id: 'Ev001',
      thread_ts: '1234567890.000',
      user: 'U1',
      text: 'maybe approve',
      ts: '1234567890.001',
    };

    capturedOnEvent!(event); // first delivery
    capturedOnEvent!(event); // duplicate — must be ignored

    await new Promise<void>((r) => setTimeout(r, 50));
    await promise;

    expect(interpretGateIntent).toHaveBeenCalledOnce();
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
});
