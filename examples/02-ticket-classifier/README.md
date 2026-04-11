# Example 2 — Reliable Output, Every Time

## What this shows

When an AI agent submits step output, Realm validates it against the declared
`input_schema` **before accepting it**. If the output is missing a required field,
uses a wrong enum value, or does not match a declared pattern — the engine rejects
it immediately, returns `provide_input` to the agent, and nothing advances
downstream.

**Pain points addressed:**

- **Non-determinism + structured output failures (#2)** — an agent might return
  `priority: "urgent"` instead of `priority: "high"` on a bad day. In most
  frameworks, that propagates silently. In Realm, it never leaves the step.
- **Tool calling brittleness (#5)** — invalid step output is caught before
  execution advances, not discovered in a downstream failure hours later.
- **Framework magic (#12)** — no hidden retry logic, no swallowed exceptions.
  The rejection is explicit and recorded in the evidence chain.

## The before / after

**Before (a plain LLM chain):**

```python
result = llm.invoke(classify_prompt.format(ticket=ticket_text))
# result might be {"category": "technical", "priority": "urgent", ...}
# "technical" is not a valid category. "urgent" is not a valid priority.
# The chain continues. The downstream record is garbage.
```

No validation fires. The schema mismatch is discovered hours later in a broken
downstream query — or never.

**After (Realm):**

```yaml
classify_ticket:
  execution: agent
  input_schema:
    type: object
    required: [category, priority, ticket_title, customer_id, one_line_summary]
    properties:
      category:
        type: string
        enum: [bug, feature_request, billing, account, other]
      priority:
        type: string
        enum: [low, medium, high, critical]
      customer_id:
        type: string
        pattern: '^CUST-[0-9]{4}$'
```

If the agent returns `category: "technical"` or `priority: "urgent"`, the engine
rejects the step immediately:

```json
{
  "agent_action": "provide_input",
  "errors": ["'urgent' is not one of [low, medium, high, critical]"]
}
```

The agent must correct and resubmit. Nothing proceeds on bad data.

## Steps

```
read_ticket      (auto — filesystem adapter, reads the ticket text)
     │ → ticket_loaded
classify_ticket  (agent — classifies into category, priority, title, customer_id)
     │ → classified        (all schema checks pass)
     ↻ provide_input       (schema rejected — agent must correct and resubmit)
record_ticket    (auto — records the classified ticket)
     │ → completed
```

Schema rejection does not advance the workflow state. The run stays in
`ticket_loaded`, and the agent receives `agent_action: provide_input` with the
validation error. The agent corrects its output and calls `execute_step` again.
Nothing downstream runs on bad data.

## Install and run

```bash
# Register the workflow (once, from the repo root):
realm workflow register examples/02-ticket-classifier/workflow.yaml

# Start the MCP server:
realm mcp
```

With VS Code: open the workspace — `realm mcp` starts automatically via
`.vscode/mcp.json`.

Then ask your agent:

> "Classify this support ticket: /path/to/ticket.txt"

The agent will:

1. Start the run — `read_ticket` executes automatically.
2. Receive a `next_action.prompt` asking it to classify the ticket.
3. Submit the classification. If any field violates the schema, it receives
   `agent_action: provide_input` with the validation error and must correct its
   output and resubmit. The workflow state does not advance until the schema
   passes.
4. Once the schema passes, `record_ticket` runs and the workflow completes.

## Test headlessly

```bash
# From the repo root:
realm workflow test examples/02-ticket-classifier/workflow.yaml -f examples/02-ticket-classifier/fixtures/
```

Two fixtures are included:

- `bug-ticket.yaml` — a P1 bug report from `CUST-3847`, expected: `completed`
- `billing-ticket.yaml` — a billing inquiry from `CUST-1122`, expected: `completed`

## Configuration reference

`params_schema` requires:

| Field | Type   | Description                                    |
| ----- | ------ | ---------------------------------------------- |
| path  | string | Absolute path to the support ticket text file. |

## What to look at next

- [Example 3 — Incident Response](../03-incident-response/) — human gate, sequential
  agent steps with personas, idempotent record step
- [YAML Schema Reference](../../docs/reference/yaml-schema.md) — all step fields,
  execution modes, gate configuration, and transitions
