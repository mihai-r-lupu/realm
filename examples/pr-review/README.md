# PR Review Example

Demonstrates `realm agent` end-to-end: a GitHub pull request is fetched
automatically, an AI agent writes a structured summary, a human approves
(or rejects) before posting, and Slack receives the result.

> **Preflight:** `realm agent` checks that all required environment variables
> are set before starting a run. If `GITHUB_TOKEN` or `SLACK_WEBHOOK_URL` is
> missing, it stops immediately with an actionable error listing which variables
> to set — no run is created.

## Prerequisites

Create a `.env` file in the repo root (the CLI loads it automatically):

```bash
OPENAI_API_KEY=sk-...           # or ANTHROPIC_API_KEY
GITHUB_TOKEN=ghp_...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

Alternatively, export them in your shell session:

```bash
export OPENAI_API_KEY=sk-...
export GITHUB_TOKEN=ghp_...
export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

Install the LLM SDK you want to use:

```bash
npm install openai          # for OpenAI
# or
npm install @anthropic-ai/sdk  # for Anthropic
```

## Run

Replace `<owner/repo>` with the GitHub repository (e.g. `octocat/Hello-World`) and
`<pr-number>` with an open pull request number in that repo.

To find an open PR:

```bash
gh pr list --repo <owner/repo> --limit 5
```

Then run:

```bash
realm agent \
  --workflow examples/pr-review/workflow.yaml \
  --params '{"repo":"<owner/repo>","pr_number":<pr-number>}'
```

To use Anthropic instead of OpenAI:

```bash
realm agent \
  --workflow examples/pr-review/workflow.yaml \
  --params '{"repo":"<owner/repo>","pr_number":<pr-number>}' \
  --provider anthropic
```

### Persisting the workflow definition

By default `realm agent` does not write to `~/.realm/workflows/`. If you want
`realm run inspect` and `realm run list` to resolve the workflow by ID, pass
`--register`:

```bash
realm agent \
  --workflow examples/pr-review/workflow.yaml \
  --params '{"repo":"<owner/repo>","pr_number":<pr-number>}' \
  --register
```

This is equivalent to running `realm workflow register examples/pr-review`
before the run.

## What to expect

1. **`fetch_pr` (auto)** — `realm agent` calls the GitHub API and stores the
   diff in the run evidence.
2. **`write_summary` (agent)** — The LLM receives the diff and produces a
   structured JSON summary (`title`, `risk`, `key_changes`, `recommendation`).
3. **`human_review` (gate)** — The run pauses. `realm agent` prints the resolved
   `gate.message` — the summary title, risk level, and AI recommendation:

   ```
   ⏸  Gate: human_review | ID: gate-abc123

      PR #42 — Fix authentication timeout in OAuth flow
      Risk: MEDIUM | AI: request_changes

      Approve: realm run respond <run-id> --gate gate-abc123 --choice approve
      Reject:  realm run respond <run-id> --gate gate-abc123 --choice reject
      Waiting for approval...
   ```

   If `SLACK_WEBHOOK_URL` is set, a Slack message is sent at this point with
   the approval command.

   The gate accepts `approve` and `reject`. The run pauses until one is
   submitted.

4. **Gate response** — In a separate terminal, run the printed command:

   ```bash
   # To approve:
   realm run respond <run-id> --gate <gate-id> --choice approve

   # To reject:
   realm run respond <run-id> --gate <gate-id> --choice reject
   ```

   `realm agent` detects the resolved gate and continues automatically.

5. **`post_to_slack` (auto, approve branch)** — If you approved, the PR
   summary title is posted to your Slack channel via the Incoming Webhook.

   **`notify_rejection` (auto, reject branch)** — If you rejected, a rejection
   notice is posted to Slack instead.

   The two steps use `when:` conditions to route based on gate choice:

   ```yaml
   post_to_slack:
     when: "human_review.choice == 'approve'"

   notify_rejection:
     when: "human_review.choice == 'reject'"
   ```

   The engine evaluates `when:` expressions against the step evidence map after
   the gate resolves. Only the branch whose condition is true becomes eligible.

6. **Run complete** — `realm agent` prints the run ID, the `write_summary` result as
   formatted JSON, and exits 0.

## Slack modes

Three modes are available. The active mode is selected automatically from which env vars are
set. For full setup instructions including step-by-step Slack app creation, see
[Slack Gate Modes reference](../docs/reference/realm-agent-slack.md).

| Mode                    | Env vars                               | Resolution                               |
| ----------------------- | -------------------------------------- | ---------------------------------------- |
| **Mode 1** — Webhook    | `SLACK_WEBHOOK_URL`                    | `realm run respond` in terminal          |
| **Mode 2** — Bot token  | `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` | Reply in Slack thread (polls every 10 s) |
| **Mode 3** — Events API | Mode 2 + `SLACK_SIGNING_SECRET`        | Reply in Slack thread (real-time push)   |

### Mode 1 — quick start (~2 min)

In Slack: **Apps → Incoming Webhooks → Add to Slack** → pick channel → copy URL.

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

### Mode 2 — quick start (~5 min)

Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps), add `chat:write` and
`channels:history` scopes, install to your workspace, invite the bot to the channel, then:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C...
```

See the [full Mode 2 setup guide](../docs/reference/realm-agent-slack.md#mode-2----bot-token-bidirectional-no-public-url) for every step.

### Mode 3 — quick start (~15 min)

Complete Mode 2 setup, copy your app’s Signing Secret (Basic Information → App Credentials),
install ngrok, and add:

```
SLACK_SIGNING_SECRET=...
```

The Events API endpoint must be configured in Slack while `realm agent` is paused at a gate
(that’s when the HTTP server is running). See the
[full Mode 3 setup guide](../docs/reference/realm-agent-slack.md#mode-3----events-api-bidirectional-real-time) for every step including ngrok.

## Inspect the run

```bash
realm run inspect <run-id>
realm run replay <run-id>
```

## Troubleshooting

**`Step 'fetch_pr' failed: HTTP 404`**

Possible causes:

- `repo` or `pr_number` does not exist — verify with:
  ```bash
  gh pr view <pr-number> --repo <owner/repo>
  ```
- `GITHUB_TOKEN` does not have access to the repository (private repos return 404, not 403).
  Confirm the token has `repo` scope and that the repository name is correct.

## Notes

- `workflow_context` file references (`{{ workflow.context.NAME }}`) are not
  available in `realm agent` runs because context files are path-resolved at
  `realm workflow register` time, not at runtime. If you need static context,
  register the workflow first and use `realm workflow run` or a registered
  workflow run via the MCP server.
