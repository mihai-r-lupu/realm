# PR Review Example

Demonstrates `realm agent` end-to-end: a GitHub pull request is fetched
automatically, an AI agent writes a structured summary, a human approves
(or rejects) before posting, and Slack receives the result.

> **Preflight:** `realm agent` checks that all required environment variables
> are set before starting a run. If `GITHUB_TOKEN` or `SLACK_WEBHOOK_URL` is
> missing, it stops immediately with an actionable error listing which variables
> to set — no run is created.

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
