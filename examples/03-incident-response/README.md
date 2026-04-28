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

**Pain points addressed:**

- **No structured human gate / HITL (#5)** — `confirm_and_send` structurally blocks
  execution until an engineer chooses `send` or `reject`. There is no prose rule asking
  the agent to wait for approval; the run physically cannot advance without the gate response.
- **Idempotency / duplicate side effects (#9)** — a completed step cannot re-execute.
  Retries, race conditions, and ambiguous alerts cannot cause duplicate posts to the channel.
- **No audit trail / observability (#3)** — both `send` and `reject` land in `completed`.
  The gate choice, the analysis, the draft, and the timing are all captured in the evidence
  chain. `realm run inspect` shows exactly what was sent, when, and who approved it.

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
> `.github/agents/*.agent.md`, add `realm/*` to its `tools:` list — this grants access
> to every tool the Realm MCP server exposes without having to list them individually.
> The MCP server can be running and the workflow registered, but the tools will not
> appear in the agent's session unless the agent explicitly includes them. Default
> (non-custom) agents in VS Code pick up all MCP tools automatically.

**Step 3** — Choose your agent path:

**Option A — Realm agent (zero friction):** Switch to the **Realm** agent in the VS Code Chat
agent picker. Then ask:

> "Triage this alert: examples/03-incident-response/alerts/high-latency.json"

> "Triage this alert: examples/03-incident-response/alerts/error-spike.json"

**Option B — Skill file (default agent):** Copy `realm-incident-response.md` from this directory
to your workspace's `.github/skills/` folder. With the default agent, trigger it with:

> "Triage this alert with Realm: examples/03-incident-response/alerts/high-latency.json"

> "Triage this alert with Realm: examples/03-incident-response/alerts/error-spike.json"

> **Why "with Realm"?** The skill file's `description` intentionally includes that phrase
> as a trigger signal so the default agent routes to Realm only when explicitly asked to.
> Without it, a general prompt like "triage this alert" could match the skill and start a
> Realm run silently. If you want fully natural-language invocation without the trigger
> phrase, open `realm-incident-response.md` and remove the phrase from the `description`
> field — the skill will then fire on any incident triage request. Use the Realm agent
> (Option A) if you want that behaviour without modifying the skill file.

**Option C — `realm agent` CLI (no VS Code required)**

Run the workflow autonomously from the terminal — no MCP client, no IDE, no configuration:

```bash
realm agent \
  --workflow examples/03-incident-response/workflow.yaml \
  --params "{\"path\":\"$(pwd)/examples/03-incident-response/alerts/high-latency.json\"}"
```

Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` before running. Use `--provider anthropic` to switch providers.

When the run reaches `confirm_and_send`, `realm agent` pauses and prints the gate ID and a `realm run respond` command. In a second terminal, run the printed command to approve or reject:

```bash
# To send:
realm run respond <run-id> --gate <gate-id> --choice send

# To reject:
realm run respond <run-id> --gate <gate-id> --choice reject
```

`realm agent` detects the resolved gate and continues automatically. When the run completes it prints the `draft_response` result as formatted JSON.

### Slack bidirectional approval (Option C — team channel)

When `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` are set, any team member watching the channel can
reply in the gate's Slack thread to approve or reject — no terminal required.

**Required environment variables:**

```bash
export SLACK_BOT_TOKEN=xoxb-...      # Slack bot token with chat:write scope
export SLACK_CHANNEL_ID=C...         # Target channel ID
export SLACK_SIGNING_SECRET=...      # From Slack app → Event Subscriptions → Signing Secret
```

**How it works:** `realm agent` posts the gate details as a message to the channel, anchoring a
reply thread. When an engineer replies (e.g. "send it" or "reject — root cause unclear"), the
agent interprets the reply using the LLM and submits the matching choice automatically.
Messages that are ambiguous trigger a clarification reply (at most twice per gate). After
that, a terminal command is still accepted as a fallback.

Two timers run while the gate is open:
- **Reminder** (default 10 min) — posts a reminder to the thread.
- **Escalation** (default 30 min) — pings the gate owner (if `gate.owner` is set) or posts a generic prompt.

**Fallback behavior:**
- If `SLACK_SIGNING_SECRET` is absent, `realm agent` falls back to polling the thread directly
  (`conversations.replies`) on a configurable interval (default 10 s).
- If `SLACK_BOT_TOKEN` is absent, the one-way webhook path (`SLACK_WEBHOOK_URL`) is used and
  the terminal command is always required.

A preflight advisory is printed at startup when the configuration is incomplete but non-blocking
(e.g. webhook-only, or bot token without signing secret).

The workspace instruction file (`.github/instructions/realm.instructions.md`) gives your agent
the generic Realm protocol. The `realm-incident-response.md` skill layers the workflow-specific
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
  modes, gate configuration, and `depends_on` / `trigger_rule`
