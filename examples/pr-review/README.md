# PR Review Example

Demonstrates `realm agent` end-to-end: a GitHub pull request is fetched
automatically, an AI agent writes a structured summary, a human approves
(or rejects) before posting, and Slack receives the result.

## Prerequisites

Set the following environment variables:

```bash
export OPENAI_API_KEY=sk-...           # or ANTHROPIC_API_KEY
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

```bash
# Run autonomously with realm agent
realm agent \
  --workflow examples/pr-review/workflow.yaml \
  --params '{"repo":"owner/repo","pr_number":42}'
```

To use Anthropic instead of OpenAI:

```bash
realm agent \
  --workflow examples/pr-review/workflow.yaml \
  --params '{"repo":"owner/repo","pr_number":42}' \
  --provider anthropic
```

### Persisting the workflow definition

By default `realm agent` does not write to `~/.realm/workflows/`. If you want
`realm run inspect` and `realm run list` to resolve the workflow by ID, pass
`--register`:

```bash
realm agent \
  --workflow examples/pr-review/workflow.yaml \
  --params '{"repo":"owner/repo","pr_number":42}' \
  --register
```

This is equivalent to running `realm workflow register examples/pr-review`
before the run.

## What to expect

1. **`fetch_pr` (auto)** — `realm agent` calls the GitHub API and stores the
   diff in the run evidence.
2. **`write_summary` (agent)** — The LLM receives the diff and produces a
   structured JSON summary (`title`, `risk`, `key_changes`, `recommendation`).
3. **`human_review` (gate)** — The run pauses. `realm agent` prints:

   ```
   ⏸  Gate: human_review | ID: gate-abc123
      Preview: { "title": "...", ... }

      Approve: realm run respond <run-id> --gate gate-abc123 --choice approve
      Reject:  realm run respond <run-id> --gate gate-abc123 --choice reject
      Waiting for approval...
   ```

   If `SLACK_WEBHOOK_URL` is set, a Slack message is sent at this point with
   the approval command.

   The gate accepts two choices: `approve` and `reject`. The run pauses until
   one of them is submitted.

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

6. **Run complete** — `realm agent` exits 0 and prints the run ID.

## Inspect the run

```bash
realm run inspect <run-id>
realm run replay <run-id>
```

## Notes

- `workflow_context` file references (`{{ workflow.context.NAME }}`) are not
  available in `realm agent` runs because context files are path-resolved at
  `realm workflow register` time, not at runtime. If you need static context,
  register the workflow first and use `realm workflow run` or a registered
  workflow run via the MCP server.
