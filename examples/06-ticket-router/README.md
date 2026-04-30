# Example 06 — Ticket Router

**Pain:** Routing rules embedded in agent instructions — a growing `SKILL.md` section that says
"if the ticket is a billing issue, handle it like X; if it's a bug, do Y; if it's a
feature request…". The agent must read, interpret, and act on those rules itself.
This is invisible, untestable, and breaks silently when the agent misreads the intent.

**After:** `when` conditions move routing rules out of prompt text and into the workflow YAML.
Each handler step declares `when: "classify_ticket.category == '<category>'"`. The engine
evaluates these automatically after `classify_ticket` completes — exactly one step becomes
eligible, and the other four are moved to `skipped_steps`. No routing logic in agent prompts.

---

## What this shows

```
read_ticket       (auto — filesystem adapter, loads the raw ticket text)
     │
identify_ticket   (agent — extracts: customer_id, product_area, product_version, reported_issue)
     │
classify_ticket   (agent — classifies: category, priority, summary)
     │
     ├── handle_billing   (when: classify_ticket.category == 'billing')
     ├── handle_bug       (when: classify_ticket.category == 'bug')
     ├── handle_feature   (when: classify_ticket.category == 'feature_request')
     ├── handle_account   (when: classify_ticket.category == 'account')
     └── handle_other     (when: classify_ticket.category == 'other')
        (exactly one fires; four land in skipped_steps)
```

**Key points:**

- `when` is evaluated by the engine against the evidence chain — not by the agent.
- Routing is declarative and visible in the workflow YAML.
- `realm run inspect <run-id>` shows `skipped_steps` — the audit trail includes which
  branches were evaluated and not taken.
- Fixtures use `skipped_steps` to verify routing directly: a fixture that only asserts
  `final_state: completed` does not test routing at all.

---

## Install

```bash
# From the repo root
npm install
```

---

## Run fixture tests

```bash
realm workflow test examples/06-ticket-router/workflow.yaml -f examples/06-ticket-router/fixtures/
```

All 5 fixtures should pass. Each fixture provides one ticket, mocks `identify_ticket` and
`classify_ticket`, and asserts both the evidence chain and `skipped_steps` — confirming
that the four non-matching handlers were correctly skipped.

---

## Run with an AI agent

**Option A — VS Code + Copilot (MCP)**

Register the workflow:

```bash
realm workflow register examples/06-ticket-router/workflow.yaml
```

Open Copilot chat and say:

> Route this ticket with Realm: examples/06-ticket-router/tickets/payment-gateway-bug.txt

Realm reads the file, runs the three agent steps, routes to `handle_bug`, and records
the full chain in the evidence log.

**Option B — `realm agent` (headless)**

```bash
realm agent examples/06-ticket-router/workflow.yaml \
  --params path=$(pwd)/examples/06-ticket-router/tickets/billing-overcharge.txt
```

**Option C — `realm agent` with a different ticket**

```bash
realm agent examples/06-ticket-router/workflow.yaml \
  --params path=$(pwd)/examples/06-ticket-router/tickets/general-question.txt
```

---

## What to look at next

- [Example 2 — Ticket Classifier](../02-ticket-classifier/) — this example builds directly
  on it: `classify_ticket.category` is the field the `when` conditions evaluate. Start there
  if you want to understand the schema design.
- [YAML Schema Reference](../../docs/reference/yaml-schema.md) — `when` condition syntax,
  `skipped_steps` in run state, and all other step fields.
