# Example 1 — The Naive vs. the Structured Run

## What this shows

A code reviewer skill file (`skill.md`) that started with one rule has grown to
five, each added after a production incident — wrong severity values, one-word
summaries, missed breaking change flags. Prose rules are ambiguous and forgettable.
When the agent has a bad run, none of them fire an error: the bad output propagates
silently, gets recorded, and is discovered later downstream.

**Before (from `skill.md`):**

```
IMPORTANT: severity must be exactly one of: critical, high, medium, low.
Do NOT use "urgent", "blocker", "minor", "trivial", "moderate", or any other
value. I had to correct this four times before adding this note.

IMPORTANT: summary must be at least two full sentences. Single-word responses
("refactor", "cleanup") are useless to the reviewer.
```

**After (in `workflow.yaml`):**

```yaml
review_changes:
  execution: agent
  input_schema:
    type: object
    required: [severity, summary, breaking_changes, action_required]
    properties:
      severity:
        type: string
        enum: [critical, high, medium, low]
      summary:
        type: string
        minLength: 20
      breaking_changes:
        type: boolean
      action_required:
        type: boolean
```

If the agent returns `severity: "urgent"` or a two-character summary, the engine
rejects the step before anything advances:

```json
{
  "agent_action": "provide_input",
  "errors": ["'urgent' is not one of [critical, high, medium, low]"]
}
```

The run stays in `diff_loaded`. Nothing downstream executes. The agent corrects
and resubmits. Every attempt is recorded in the immutable evidence chain.

**Pain points addressed:**

- **Verification gap (#1)** — step output is verified structurally before the run advances.
- **Non-determinism + structured output failures (#2)** — invalid enum values and
  short summaries are rejected at the boundary, not discovered downstream.
- **Instruction file spiral (#6)** — the five prose rules in `skill.md` are replaced
  by the `input_schema` declaration. No `IMPORTANT:` annotations accumulate.
- **No audit trail (#8)** — every run produces an immutable evidence chain:
  who reviewed what, what fields were returned, whether any step was rejected.

## Install

```bash
# From the repo root — installs all workspace packages:
npm install
```

No per-example build step is required.

## Run it (headless)

```bash
# From the repo root:
realm workflow test examples/01-code-reviewer/workflow.yaml -f examples/01-code-reviewer/fixtures/
```

Expected output:

```
Realm Test — examples/01-code-reviewer/workflow.yaml
  PASS breaking API change — OAuth provider parameter
  PASS null pointer fix — early return guard

2/2 passed
```

## Run it with an AI agent

```bash
# Register the workflow (once, from the repo root):
realm workflow register examples/01-code-reviewer/workflow.yaml

# Start the MCP server:
realm mcp
```

With VS Code: open the workspace — `realm mcp` starts automatically via
`.vscode/mcp.json`. Then ask your agent:

> "Review this diff: examples/01-code-reviewer/diffs/add-oauth-provider.diff"

The agent will start the run, load the diff automatically, then receive a prompt
asking for the structured review. If any field violates the schema — wrong enum
value, summary too short, missing boolean — it receives `agent_action: provide_input`
with the exact validation error and must correct and resubmit. The workflow state
does not advance until the schema passes.

## What to look at next

- [Example 2 — Reliable Output, Every Time](../02-ticket-classifier/) — schema
  enforcement with enum validation and pattern matching across five fields
- [YAML Schema Reference](../../docs/reference/yaml-schema.md) — all step fields,
  execution modes, `input_schema` constraints, and transitions
