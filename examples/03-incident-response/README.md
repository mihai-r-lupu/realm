# Example 3 — Incident First-Response

## What this shows

A four-step incident triage workflow. When an alert fires, an agent analyzes the root cause
and drafts an oncall channel message. The run cannot post until an engineer explicitly approves
it at a human gate. If the engineer rejects the draft, the run ends immediately — nothing is
sent, and the decision is recorded. Every step is captured in an immutable evidence chain.

This example builds on the chained data-flow pattern from [Example 2](../02-ticket-classifier/)
— `draft_response` reads validated fields from `analyze_cause` via `context.resources`, so
the drafter cannot invent a root cause or severity. The new concept introduced here is the
human gate: after two verified agent steps, execution is structurally blocked until an engineer
chooses to send or reject the draft.

**The before/after:**

Before Realm, an oncall agent built on a growing SKILL.md fires on every alert and posts
directly to the incident channel. After an ambiguous alert, it posts contradictory root causes
three times (two retries + a race condition duplicate). The SKILL.md grows:

> CRITICAL: Do NOT post without first checking whether a message was already sent.  
> CRITICAL: Do NOT post if confidence is below 70%.  
> CRITICAL: Never retry a post — check the channel first.  
> CRITICAL: Always wait for explicit engineer approval.

Four CRITICALs added after four real incidents. There is no record of what was sent, when, or
who approved it.

With Realm: the post cannot happen until `confirm_and_send` receives the engineer's `send`
choice — a structural constraint, not a prose rule. Both `send` and `reject` land in `completed`
— the gate choice is permanently recorded in the evidence chain. `realm run inspect` shows
who approved, what the analysis was, and exactly what text was sent.

## What it demonstrates

`draft_response` reads `context.resources.analyze_cause` — the same chained data-flow pattern
introduced in [Example 2](../02-ticket-classifier/), now applied to a step that feeds a human
gate. The drafter receives the analyzer's validated `root_cause` and `severity` fields; it
cannot invent a root cause from thin air. This matters here more than anywhere: the engineer
approves or rejects based on what the drafter actually received, not what the drafter assumed.

| Feature                          | How it appears                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| Human gate with real stakes      | `confirm_and_send` blocks until engineer chooses `send` or `reject`                      |
| Gate choice recorded in evidence | Both `send` and `reject` produce `completed` — the choice is in the evidence audit trail |
| Idempotency                      | A completed step cannot re-execute — duplicate retries cannot re-post                    |
| Chained agent steps              | `draft_response` reads `context.resources.analyze_cause` — drafter gets verified data   |
| Evidence chain                   | Analysis, draft, and gate choice all captured with timing and hash                       |
| `FileSystemAdapter`              | Reads alert JSON from disk — zero auth, zero network                                     |
| Swap-readiness                   | Replace the filesystem service with a Slack or PagerDuty adapter — zero YAML changes     |

## Install

```bash
npm install  # from repo root — installs all workspace packages
```

## Run fixture tests

```bash
realm workflow test examples/03-incident-response --fixtures examples/03-incident-response/fixtures
```

Expected output:

```
Realm Test — examples/03-incident-response
  PASS approved
  PASS rejected

2/2 passed
```

Both fixtures run the full workflow end-to-end against pre-recorded agent responses. The `approved`
fixture routes through the `send` gate choice; the `rejected` fixture routes through `reject`. Both
produce 4 evidence entries and land in `completed`.

Fixture tests use an in-memory store — no run-id is produced and `realm run list` will not show
these runs. To get an inspectable run record, use the AI agent mode below.

## Run it with an AI agent (any VS Code agent with MCP support)

**Step 1** — Register the workflow so the global Realm MCP server can find it:

```bash
realm workflow register examples/03-incident-response
```

**Step 2** — VS Code picks up `.vscode/mcp.json` from the repo root automatically. The single
`realm` MCP server starts on first use and serves all registered workflows — no build step,
no per-example configuration required.

> **Custom agents (Copilot, Claude):** if you are using a custom agent defined in
> `.github/agents/*.agent.md`, make sure its `tools:` list includes the Realm MCP
> tools — for example `realm-list_workflows`, `realm-start_run`, `realm-execute_step`.
> The MCP server can be running and the workflow registered, but the tools will not
> appear in the agent's session unless they are explicitly listed. Default (non-custom)
> agents in VS Code pick up all MCP tools automatically.

**Step 3** — In Copilot chat, ask:

> "Triage this alert with Realm: examples/03-incident-response/alerts/high-latency.json"

The workspace instruction file (`.github/instructions/realm.instructions.md`) gives your agent
the generic Realm protocol. The `skill.md` in this directory layers the workflow-specific
behaviour on top.

The MCP session produces a run-id. Once the run completes, inspect the full evidence chain:

```bash
realm run inspect <run-id>
```

If the tools don't appear in Copilot, see [examples/README.md](../README.md#troubleshooting-mcp--vs-code).

## Agent profiles

The two agent steps each use a dedicated persona from `agents/`:

```
agents/
  incident-analyzer.md   # loaded by analyze_cause — triage focus, honest confidence
  response-drafter.md    # loaded by draft_response — concise channel message structure
```

Each profile is hashed at registration time and recorded in the evidence chain. `realm run inspect`
shows the profile name and hash in cyan after the step name — proving which persona was active.

## Sample alerts

```
alerts/
  high-latency.json   # P2 — DB connection pool exhaustion, recent deployment, clear signal
  error-spike.json    # P1 — upstream dependency failure, no recent deployment, ambiguous
```

Point the workflow at any JSON file containing alert data. The agent reads whatever structure
is present via `context.resources.read_alert.content`.

---

## What to look at next

- [Example 2 — Ticket Classifier](../02-ticket-classifier/) — agent step schema enforcement,
  `input_schema` validation, `provide_input` on schema rejection
- [YAML Schema Reference](../../docs/reference/yaml-schema.md) — all step fields, execution
  modes, gate configuration, and transitions
