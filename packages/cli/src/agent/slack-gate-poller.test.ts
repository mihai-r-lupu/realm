// slack-gate-poller.test.ts — Tests for the Slack thread polling fallback.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { pollSlackThread } from './slack-gate-poller.js';

// Gate opened at Unix timestamp 1704067200 (2024-01-01T00:00:00Z).
const GATE_OPENED_AT = new Date(1704067200 * 1000);

function makeRepliesResponse(messages: Array<Record<string, unknown>>) {
  return { ok: true, messages };
}

function stubFetch(data: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ json: async () => data }),
  );
}

describe('pollSlackThread', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('passes a valid human reply to onCandidate', async () => {
    vi.useFakeTimers();
    const onCandidate = vi.fn();
    const controller = new AbortController();

    stubFetch(
      makeRepliesResponse([
        // Valid human message after gate opened
        { ts: '1704067261.001', text: 'send it please', user: 'U1' },
      ]),
    );

    pollSlackThread({
      botToken: 'xoxb-test',
      channelId: 'C123',
      threadTs: '1704067200.000',
      gateOpenedAt: GATE_OPENED_AT,
      intervalMs: 1000,
      onCandidate,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(1001);
    controller.abort();

    expect(onCandidate).toHaveBeenCalledOnce();
    expect(onCandidate).toHaveBeenCalledWith('send it please');
  });

  it('does not pass bot messages to onCandidate', async () => {
    vi.useFakeTimers();
    const onCandidate = vi.fn();
    const controller = new AbortController();

    stubFetch(
      makeRepliesResponse([
        { ts: '1704067261.001', text: 'Bot reply', bot_id: 'B123', user: 'U_BOT' },
        { ts: '1704067261.002', text: 'Also bot', subtype: 'bot_message', user: 'U_BOT2' },
      ]),
    );

    pollSlackThread({
      botToken: 'xoxb-test',
      channelId: 'C123',
      threadTs: '1704067200.000',
      gateOpenedAt: GATE_OPENED_AT,
      intervalMs: 1000,
      onCandidate,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(1001);
    controller.abort();

    expect(onCandidate).not.toHaveBeenCalled();
  });

  it('does not pass messages before gateOpenedAt to onCandidate', async () => {
    vi.useFakeTimers();
    const onCandidate = vi.fn();
    const controller = new AbortController();

    stubFetch(
      makeRepliesResponse([
        // ts is BEFORE gate opened (1704067200) — should be filtered
        { ts: '1704067100.001', text: 'Old message', user: 'U1' },
        // ts exactly at gate opened — treated as before (<=), filtered
        { ts: '1704067200.000', text: 'Exactly at open', user: 'U1' },
      ]),
    );

    pollSlackThread({
      botToken: 'xoxb-test',
      channelId: 'C123',
      threadTs: '1704067200.000',
      gateOpenedAt: GATE_OPENED_AT,
      intervalMs: 1000,
      onCandidate,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(1001);
    controller.abort();

    expect(onCandidate).not.toHaveBeenCalled();
  });

  it('calls onCandidate only once for duplicate ts values', async () => {
    vi.useFakeTimers();
    const onCandidate = vi.fn();
    const controller = new AbortController();

    const msg = { ts: '1704067261.001', text: 'approve', user: 'U1' };
    // Return the same message on two consecutive polls.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ json: async () => makeRepliesResponse([msg]) }),
    );

    pollSlackThread({
      botToken: 'xoxb-test',
      channelId: 'C123',
      threadTs: '1704067200.000',
      gateOpenedAt: GATE_OPENED_AT,
      intervalMs: 1000,
      onCandidate,
      signal: controller.signal,
    });

    // Two poll cycles.
    await vi.advanceTimersByTimeAsync(2001);
    controller.abort();

    // Despite two polls, onCandidate called only once due to deduplication.
    expect(onCandidate).toHaveBeenCalledOnce();
  });
});
