# Slack Gate Notifications — `realm agent`

When `realm agent` pauses at a human gate, it can notify via Slack. Three modes are
available, each with different setup requirements and interaction patterns.

> **Scope:** These modes control how gate notifications are sent and how gates can be resolved
> during `realm agent` runs. If your workflow uses `uses_service: slack_notifications` steps
> (e.g. to post a result after approval), those post via `SLACK_WEBHOOK_URL` and are unaffected
> by which gate mode you choose.

---

## Mode comparison

|                         | Mode 1 — Webhook                | Mode 2 — Socket Mode                                       | Mode 3 — Events API                                             |
| ----------------------- | ------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| **Env vars**            | `SLACK_WEBHOOK_URL`             | `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` + `SLACK_APP_TOKEN` | `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` + `SLACK_SIGNING_SECRET` |
| **Gate notification**   | Posted to channel               | Posted to channel                                          | Posted to channel                                               |
| **Resolution**          | `realm run respond` in terminal | Reply in Slack thread                                      | Reply in Slack thread                                           |
| **Latency**             | Instant (terminal)              | < 1 s (WebSocket push)                                     | < 1 s (push event)                                              |
| **Public URL required** | No                              | No                                                         | Yes (ngrok for local dev)                                       |
| **App Token required**  | No                              | Yes (`xapp-...`)                                           | No                                                              |
| **Setup time**          | ~2 min                          | ~10 min                                                    | ~15 min                                                         |
| **Best for**            | Local dev, scripts              | Local dev, team use                                        | Production deployments                                          |

The active mode is selected automatically based on which env vars are set. No flag required.

When both `SLACK_APP_TOKEN` and `SLACK_SIGNING_SECRET` are set, Socket Mode (Mode 2) takes
precedence. To use Events API, remove `SLACK_APP_TOKEN` from your environment.

---

## Mode 1 — Webhook

`realm agent` posts the gate message to a Slack channel. You approve or reject by running the
printed `realm run respond` command in your terminal. No Slack app, no bot, no port.

### Setup (~2 minutes)

**Step 1.** In Slack, click **Apps** in the sidebar → search for **Incoming WebHooks** →
**Add to Slack** → pick the channel → **Add Incoming WebHooks integration** → copy the
**Webhook URL**.

Or via the API dashboard: [api.slack.com/apps](https://api.slack.com/apps) → pick your app →
**Incoming Webhooks** → toggle on → **Add New Webhook to Workspace** → pick channel → copy URL.

**Step 2.** Add to `.env`:

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

### What you see

When a gate opens, Slack shows the formatted gate message along with the `realm run respond`
command. Run that command in a separate terminal to submit your choice.

---

## Mode 2 — Socket Mode (bidirectional, no public URL)

`realm agent` posts the gate message via your bot's `chat.postMessage` API, then opens a
persistent WebSocket connection to Slack using your App Token. Slack pushes thread reply
events over this WebSocket in real time — no polling, no public URL, sub-second latency.
The LLM interprets the reply and submits the matching gate choice. Ambiguous replies get a
clarification thread reply (at most twice). The terminal command is always accepted as a fallback.

Unlike the Events API (Mode 3), Socket Mode opens an outbound WebSocket connection from
the CLI to Slack — no inbound port, no public URL, and no ngrok required. This makes
Socket Mode the right choice for local development and most production deployments where
inbound HTTP from Slack is impractical.

### Setup (~10 minutes)

**Step 1.** Create a Slack app — go to [api.slack.com/apps](https://api.slack.com/apps) →
**Create New App → From scratch** → give it a name (e.g. "Realm") → select your workspace.

**Step 2.** Add bot scopes — in your app, go to **OAuth & Permissions → Scopes →
Bot Token Scopes** and add:

- `chat:write` — post gate messages
- `channels:history` — read thread replies in public channels

For private channels, add `groups:history` instead of (or in addition to) `channels:history`.

**Step 3.** Install to workspace — go to **OAuth & Permissions → Install to Workspace →
Allow**. Copy the **Bot User OAuth Token** (starts with `xoxb-`).

**Step 4.** Find your channel ID:

- **Browser:** open Slack in a browser, navigate to the channel — copy the last path segment
  of the URL (e.g. `https://app.slack.com/client/T.../C123ABC456` → ID is `C123ABC456`).
- **Desktop app:** right-click the channel → **View channel details** → scroll to the bottom
  — the channel ID is shown there.

**Step 5.** Invite the bot to the channel — in the channel, type `/invite @YourAppName`.

**Step 6.** Enable Socket Mode and get an App Token — in your Slack app, go to **Settings →
Socket Mode** and toggle **Enable Socket Mode** on.

Then go to **Settings → Basic Information → App-Level Tokens** →
**Generate Token and Scopes**. Give it a name (e.g. "realm-socket"), add the
`connections:write` scope, and click **Generate**. Copy the token (starts with `xapp-`).

**Step 7.** Add to `.env`:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C...
SLACK_APP_TOKEN=xapp-...
```

### What you see

When a gate opens, Slack shows the formatted gate message with reply instructions. Reply with
a valid choice directly in the thread (`send` / `approve` / `reject` — whatever the gate
defines). The bot resolves it and the run continues.

---

## Mode 3 — Events API (bidirectional, real-time)

Same experience as Mode 2, but Slack pushes events to `realm agent` over HTTP rather than the
persistent WebSocket connection. Requires a URL reachable by Slack — use ngrok for local
development.

**When to prefer Mode 3 over Mode 2:** Both modes respond in under 1 second. Use Mode 3 when
deploying `realm agent` as a long-running service behind a stable public URL, or when your
infrastructure already expects inbound webhooks from Slack.

### Setup — local dev with ngrok (~15 minutes)

**Step 1.** Complete the full Mode 2 setup above (steps 1--5 and step 7, skipping step 6 ---
Socket Mode is not required for Mode 3; `SLACK_APP_TOKEN` is not needed).

**Step 2.** Get your Signing Secret — in your Slack app, go to **Settings → Basic Information
→ App Credentials → Signing Secret** and copy it.

**Step 3.** Install ngrok (one-time):

```bash
# macOS
brew install ngrok

# or npm
npm install -g @ngrok/ngrok

# activate your free account token (sign up at ngrok.com)
ngrok config add-authtoken <your-ngrok-token>
```

**Step 4.** Add to `.env`:

```
SLACK_SIGNING_SECRET=...
```

**Step 5.** On your next run, when `realm agent` pauses at a gate, the Events API HTTP server
starts on port 3100. While the gate is open:

1. In a second terminal, start ngrok:

   ```bash
   ngrok http 3100
   ```

   Copy the `https://` forwarding URL (e.g. `https://abc123.ngrok.io`).

2. In your Slack app, go to **Event Subscriptions → Enable Events → Request URL** and paste:

   ```
   https://abc123.ngrok.io/slack/events
   ```

   Slack sends a verification challenge — your running server responds and the URL turns green.

3. Under **Subscribe to bot events**, click **Add Bot User Event** and add `message.channels`
   (or `message.groups` for private channels).

4. Click **Save Changes**.

This configuration persists — you only need to do it once per Slack app. On future runs the
server starts, Slack pushes events, and replies resolve gates in under a second.

> **Why the server only starts at gate-open time:** `realm agent` is a one-shot CLI command,
> not a long-running service. The Events API HTTP server spins up when the first gate opens
> and shuts down when the gate resolves. This is fine for local development — the ngrok setup
> step is a one-time configuration that Slack remembers. For production, see below.

### Setup — production with a stable URL

**Step 1.** Deploy `realm agent` as a long-running service with port 3100 exposed behind a
load balancer or reverse proxy.

**Step 2.** In your Slack app, configure the Events API before the first run:

- **Event Subscriptions → Enable Events → Request URL**: your server URL + `/slack/events`
- The service must be running when you set this — Slack verifies it immediately.
- **Subscribe to bot events**: add `message.channels` (and `message.groups` for private channels).

**Step 3.** Set `SLACK_SIGNING_SECRET` in your environment. The server starts with the first
gate and verifies every incoming payload using HMAC-SHA256 with the signing secret.

---

## Environment variable reference

| Variable                             | Required by          | Description                                                                                          |
| ------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `SLACK_WEBHOOK_URL`                  | Mode 1               | Incoming Webhook URL. Also required by `slack_notifications` service adapter steps in your workflow. |
| `SLACK_BOT_TOKEN`                    | Mode 2, 3            | Bot User OAuth Token (starts with `xoxb-`).                                                          |
| `SLACK_CHANNEL_ID`                   | Mode 2, 3            | Channel ID where the bot posts (e.g. `C123ABC456`).                                                  |
| `SLACK_APP_TOKEN`                    | Mode 2               | App-level token (starts with `xapp-`). Enables Socket Mode. Requires the `connections:write` scope.  |
| `SLACK_SIGNING_SECRET`               | Mode 3               | Signing secret for HMAC-SHA256 verification. Enables the Events API server.                          |
| `SLACK_EVENTS_PORT`                  | Mode 3 (optional)    | Port for the Events API HTTP server. Default: `3100`.                                                |
| `SLACK_GATE_REMINDER_INTERVAL_MS`    | Mode 2, 3 (optional) | Delay in ms before a reminder is posted to the gate thread. Default: `600000` (10 min).              |
| `SLACK_GATE_ESCALATION_THRESHOLD_MS` | Mode 2, 3 (optional) | Delay in ms before an escalation message is posted. Default: `1800000` (30 min).                     |

---

## Troubleshooting

**Mode 1 — "Waiting for approval..." and nothing appears in Slack**

Verify `SLACK_WEBHOOK_URL` is set. Webhook URLs are not shown again after creation — if you
lost it, go to your Slack app's Incoming Webhooks page and create a new one.

**Mode 2 — Socket Mode connection fails to establish**

- Confirm `SLACK_APP_TOKEN` starts with `xapp-` and is not a bot token (`xoxb-`).
- Confirm the Slack app has Socket Mode enabled (**Settings → Socket Mode → Enable Socket Mode**).
- Confirm the App Token has the `connections:write` scope (**Settings → Basic Information →
  App-Level Tokens**).
- Confirm the bot is a member of the channel (`/invite @YourAppName` in the channel).

**Mode 2 — Bot posts the message but the gate doesn't resolve from Slack replies**

- Reply _in the thread_ anchored to the bot's gate message, not in the main channel feed.
- Confirm the `channels:history` scope is present under OAuth & Permissions. For private
  channels, `groups:history` is required instead of (or in addition to) `channels:history`.

**Mode 2 — Reply is picked up but the gate doesn't resolve**

The LLM interprets the reply against the gate's valid choices. Ambiguous messages get a
clarification reply (up to twice). If the reply is completely unrelated to the gate choices,
use the terminal command as a fallback.

**Mode 3 — Slack shows "Your URL didn't respond with a 200 OK" when setting up Events API**

The Events API server starts when a gate opens during a `realm agent` run — not at CLI
startup. Make sure:

- `realm agent` is running and paused at a gate.
- ngrok is running and forwarding to port 3100.
- The URL you pasted ends with `/slack/events`.
- `SLACK_SIGNING_SECRET` is set and matches the value in your Slack app's Basic Information page.

**Mode 3 — "Bidirectional Slack resolution unavailable (no thread anchor)"**

`realm agent` failed to get a message `ts` when posting the gate notification (rare — usually
a transient API error). The terminal command will still resolve the gate. Retry the run to
attempt bidirectional again.
