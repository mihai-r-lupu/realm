# Example 09 — Webhook PR Review

This example drives an automatic GitHub PR review using the `realm webhook` command,
MCP tools, and a human approval gate.

## What it does

1. `realm webhook` receives a `pull_request:opened` event from GitHub.
2. Signature is verified (HMAC-SHA256). Invalid signatures are rejected with 403.
3. A new run is created and `realm agent --run-id <id>` is spawned as a detached process.
4. The agent drives three agentic steps:
   - **fetch_pr** — uses GitHub MCP tools to fetch the diff and changed files.
   - **analyze_changes** — drafts a review comment based on the diff.
   - **approve_review** — pauses for a human to review and approve the draft.
5. After human approval, **post_review** posts the comment via the GitHub adapter.

## Prerequisites

- `GITHUB_TOKEN` env var set with `pull_requests: write` and `contents: read` scopes.
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` set.
- A public HTTPS endpoint for the webhook (use [ngrok](https://ngrok.com/) for local testing).

## Quick start

### 1. Expose a local port with ngrok

```bash
ngrok http 4000
```

Copy the `https://` forwarding URL.

### 2. Configure a GitHub webhook

In your repository → **Settings → Webhooks → Add webhook**:

- **Payload URL**: `https://<your-ngrok-id>.ngrok-free.app`
- **Content type**: `application/json`
- **Secret**: any random string you choose (you'll pass this as `--secret`)
- **Events**: select **Pull requests**

### 3. Start the webhook listener

```bash
GITHUB_TOKEN=ghp_... \
OPENAI_API_KEY=sk-... \
realm webhook \
  --workflow examples/09-webhook-pr-review/workflow.yaml \
  --port 4000 \
  --secret <your-webhook-secret> \
  --event pull_request:opened,pull_request:synchronize \
  --provider openai \
  --model gpt-4o
```

### 4. Open a pull request

Open (or push a new commit to) a PR in the configured repository.
The terminal will log the spawned agent PID. Watch the agent output and respond
to the human gate when it pauses for approval.

## Why `realm webhook` and not `realm serve`?

`realm serve` exposes the Realm MCP API for agent-to-Realm communication.
`realm webhook` is a separate entry point for inbound events from external systems.
The two may run in parallel if needed.

## Limitations (V1)

- **Dedup cache is in-memory.** If the webhook process restarts, the cache is lost.
  GitHub may redeliver events that were already processed. Downstream idempotency
  (e.g. checking whether a review already exists before posting) is recommended
  for production use.
- **No queue.** Two events arriving simultaneously create two independent runs.
  This is intentional — runs are isolated.
- **Single event source.** Only GitHub webhooks are supported in this release.

## Configuration reference

| Flag         | Env var                 | Required | Description                                                           |
| ------------ | ----------------------- | -------- | --------------------------------------------------------------------- |
| `--workflow` | —                       | yes      | Path to the workflow YAML file                                        |
| `--port`     | —                       | yes      | Port to listen on                                                     |
| `--secret`   | `GITHUB_WEBHOOK_SECRET` | yes\*    | HMAC secret (\*one of the two must be set)                            |
| `--event`    | —                       | no       | Comma-separated `event:action` pairs (default: `pull_request:opened`) |
| `--provider` | —                       | no       | LLM provider forwarded to `realm agent` (`openai`/`anthropic`)        |
| `--model`    | —                       | no       | Model name forwarded to `realm agent`                                 |
