# Example 08 — PR Review

**Pain:** A developer using `realm agent` for code review gets an AI summary in a Slack
notification and nothing on the PR itself. The gate choice (approve/reject) controls whether
the notification fires — not what happens to the pull request. The LLM's recommendation has
no effect on the run outcome, and the evidence chain records only "posted to Slack", not what
the engineer decided.

**After:** The gate choice is the engineering decision — `approve` or `request_changes`. Both
choices post the review comment to GitHub. The evidence chain records which outcome was chosen,
enforced by `when` conditions that the engine evaluates — not by agent instructions that can be
ignored.

---

## What this shows

```
fetch_pr              (auto — github adapter, get_pr_diff)
     │
write_review          (agent — risk, key_changes, recommendation, review_comment)
     │                 Human sees the review via display field; chooses the outcome.
confirm_review        (gate — approve / request_changes)
     ├── post_approval          (auto — github adapter, post_comment)
     └── post_changes_request   (auto — github adapter, post_comment)
```

**Key points:**

- Topology distinction: this is the only example where both gate choices trigger a write,
  routed to different PR outcomes. Contrast with Example 03 (one branch writes, other skips)
  and Example 07 (approve fires parallel writes, reject skips both).
- `write_review` is a pure agent step — no gate. It produces `{risk, key_changes,
recommendation, review_comment}` and renders them via `display:` in the terminal.
- `confirm_review` is a separate auto step with `trust: human_confirmed`. Agent reasoning and
  human checkpoint are distinct steps, not combined as in Example 07.
- `write_review.display:` uses short paths (`{{ risk }}`, `{{ key_changes | bullets }}`)
  relative to step output. `confirm_review.gate.message:` uses full
  `context.resources.write_review.*` paths. Both are required; each serves a different
  rendering context.
- `gate.choices` are `approve` and `request_changes` — real GitHub review outcomes.
- `post_approval` and `post_changes_request` both `depend_on: [confirm_review]` with mutually
  exclusive `when` conditions. The false branch is moved to `skipped_steps` by the engine
  after gate resolution.
- `resolution_messages` provides a confirmation message for both choices.
- `GITHUB_TOKEN` needs `contents:read` to fetch the diff and `issues:write` to post the
  comment (GitHub's PR comment endpoint is the Issues API).

---

## Install

```bash
# From the repo root
npm install
```

---

## Run fixture tests

```bash
realm workflow test examples/08-pr-review/workflow.yaml -f examples/08-pr-review/fixtures/
```

Two fixtures:

- `approve-pr.yaml` — gate choice: approve; `post_approval` in evidence; `post_changes_request` in `skipped_steps`
- `request-changes-pr.yaml` — gate choice: request_changes; `post_changes_request` in evidence; `post_approval` in `skipped_steps`

Expected output:

```
Realm Test — examples/08-pr-review/workflow.yaml
  PASS pr review — approved
  PASS pr review — changes requested

2/2 passed
```

---

## Requirements

Create a `.env` file in the repo root:

```bash
GITHUB_TOKEN=ghp_...
```

Token needs `contents:read` (to fetch the diff) and `issues:write` (to post the comment —
GitHub's PR comment endpoint is the Issues API). The workflow reads the token via
`auth.token_from: secrets.GITHUB_TOKEN`.

---

## Run with an AI agent

### Option A — VS Code + MCP

Register the workflow and open a Copilot chat session:

```bash
realm workflow register examples/08-pr-review/workflow.yaml
```

Then in Copilot chat (agent mode with Realm tools):

> Run the PR Review workflow for repo owner/repo PR number 42.

### Option B — `realm agent` CLI

```bash
realm agent \
  --workflow examples/08-pr-review/workflow.yaml \
  --params '{"repo":"owner/repo","pr_number":42}'
```

When the run reaches the gate, the CLI prints the review output and waits:

```
⏸  Gate: confirm_review | ID: gate-abc123

   PR #42 — owner/repo

   Risk: LOW
   AI recommendation: approve

   Key changes:
   • session.ts: session timeout is now configurable via config.sessionTimeoutSeconds
   • Falls back to hardcoded 3600 if config field is absent

   Review comment to post:
   Approve. Low risk — changes timeout to be config-driven with a safe fallback.
   No auth logic altered. Config field should be documented.

   Approve:          realm run respond <run-id> --gate <gate-id> --choice approve
   Request changes:  realm run respond <run-id> --gate <gate-id> --choice request_changes
   Waiting for response...
```

---

## Inspect the evidence chain

On approve: evidence includes `fetch_pr`, `write_review`, `confirm_review`, `post_approval` —
all `success`. `post_changes_request` appears in `skipped_steps`.

On request_changes: evidence includes `fetch_pr`, `write_review`, `confirm_review`,
`post_changes_request` — all `success`. `post_approval` appears in `skipped_steps`.

The unevaluated branch does not appear in evidence. The gate choice is recorded permanently.

```bash
realm run inspect <run-id>
```

---

## Configuration reference

| Field     | Type    | Description                              |
| --------- | ------- | ---------------------------------------- |
| repo      | string  | GitHub repository in `owner/repo` format |
| pr_number | integer | The pull request number to review        |

---

## What to look at next

- Example 03 — Incident Response: original gate example; one branch writes, other skips.
- Example 07 — Issue Triage: gate on agent step; approve fires parallel writes, reject skips both.
- YAML Schema Reference: `trust: human_confirmed`, `when` condition syntax, `gate.message`,
  `resolution_messages`, `display` field.
