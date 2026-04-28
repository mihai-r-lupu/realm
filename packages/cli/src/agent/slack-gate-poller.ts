// slack-gate-poller.ts — Polls a Slack thread for human replies when Events API is not configured.
// Used as a local CLI fallback when SLACK_BOT_TOKEN and SLACK_CHANNEL_ID are set
// but no Events API endpoint (SLACK_SIGNING_SECRET) is available.

export interface SlackPollConfig {
  /** SLACK_BOT_TOKEN — used in Authorization header. */
  botToken: string;
  /** SLACK_CHANNEL_ID — channel containing the gate notification thread. */
  channelId: string;
  /** ts of the gate notification message — anchor for conversations.replies. */
  threadTs: string;
  /** Only process messages sent after this time. Set to gate opened_at. */
  gateOpenedAt: Date;
  /** Polling interval in milliseconds. Default: 10000. */
  intervalMs: number;
  /** Called with the text of each new human message. */
  onCandidate: (text: string) => void;
  /** When aborted, polling stops cleanly after the current interval. */
  signal?: AbortSignal;
}

/**
 * Begins polling a Slack thread for new human replies.
 * Filters out bot messages, messages before `gateOpenedAt`, and duplicate messages.
 * Calls `onCandidate` at most once per unique message ts.
 */
export function pollSlackThread(config: SlackPollConfig): void {
  const { botToken, channelId, threadTs, gateOpenedAt, intervalMs, onCandidate, signal } = config;

  const processed = new Set<string>();
  // Convert gateOpenedAt to a Slack-style float timestamp string for comparison.
  const gateOpenedSec = gateOpenedAt.getTime() / 1000;

  const poll = async (): Promise<void> => {
    if (signal?.aborted) return;

    try {
      const url =
        `https://slack.com/api/conversations.replies` +
        `?channel=${encodeURIComponent(channelId)}&ts=${encodeURIComponent(threadTs)}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      const data = (await response.json()) as {
        ok: boolean;
        messages?: Array<Record<string, unknown>>;
      };

      if (data.ok && Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          const msgTs = msg['ts'] as string | undefined;
          if (!msgTs) continue;

          // Skip messages sent before or at gate opened time.
          if (parseFloat(msgTs) <= gateOpenedSec) continue;

          // Filter bot messages.
          if (msg['subtype'] === 'bot_message' || msg['bot_id'] !== undefined) continue;

          // Deduplicate by ts.
          if (processed.has(msgTs)) continue;
          processed.add(msgTs);

          const text = msg['text'] as string | undefined;
          if (text) onCandidate(text);
        }
      }
    } catch {
      // Polling failures are silent — gate remains open until a valid reply arrives.
    }

    if (!signal?.aborted) {
      setTimeout(() => { void poll(); }, intervalMs);
    }
  };

  setTimeout(() => { void poll(); }, intervalMs);
}
