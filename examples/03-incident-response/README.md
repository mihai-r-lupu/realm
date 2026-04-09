# Example 3 — Incident First-Response

## What this shows

A five-step incident triage workflow. When an alert fires, an agent analyzes the root cause
and drafts an oncall channel message. The run cannot post until an engineer explicitly approves
it at a human gate. If the engineer rejects the draft, the run ends immediately — nothing is
sent, and the decision is recorded. Every step is captured in an immutable evidence chain.

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
choice — a structural constraint, not a prose rule. `record_decision` is
`allowed_from_states: [approved]`, so it only runs once per approval. `realm run inspect` shows
who approved, what the analysis was, and exactly what text was sent.

## What it demonstrates

| Feature | How it appears |
|---|---|
| Human gate with real stakes | `confirm_and_send` blocks until engineer chooses `send` or `reject` |
| Gate choice recorded in evidence | Both `send` and `reject` produce `completed` — the choice is in the evidence audit trail |
| Idempotency | A completed step cannot re-execute — duplicate retries cannot re-post |
| Sequential agent steps | `draft_response` cannot run until `analyze_cause` output is validated |
| Evidence chain | Analysis, draft, and gate choice all captured with timing and hash |
| `FileSystemAdapter` | Reads alert JSON from disk — zero auth, zero network |
| Swap-readiness | Replace the filesystem service with a Slack or PagerDuty adapter — zero YAML changes |

## Install

```bash
npm install  # from repo root — installs all workspace packages
```

## Run it (headless)

```bash
cd examples/03-incident-response
npm run build
node dist/driver.js fixtures/approved.yaml
```

Expected output:
```
Run: <uuid>
Workflow: Incident First-Response v1
Fixture: approved

✓ analyze_cause              —   severity=P2   confidence=high
✓ draft_response             —   headline=P2 — payments-api degraded — DB connection pool exhausted
✓ confirm_and_send           —   choice=send
─────────────────────────────────────────────────────────
Final state: completed
Evidence hash chain: ok (4/4)
```

Try the rejection fixture — the engineer rejects the draft, nothing is sent:

```bash
node dist/driver.js fixtures/rejected.yaml
```

Expected output:
```
Run: <uuid>
Workflow: Incident First-Response v1
Fixture: rejected

✓ analyze_cause              —   severity=P1   confidence=medium
✓ draft_response             —   headline=P1 — auth-service down — session-store dependency failure
✓ confirm_and_send           —   choice=reject
─────────────────────────────────────────────────────────
Final state: completed
Evidence hash chain: ok (4/4)
```

Both fixtures produce 4 evidence entries. The choice (`send` vs `reject`) is recorded in the
gate evidence — `realm run inspect` shows who chose what and when.

To inspect the full evidence chain of any run:
```bash
node ../../packages/cli/dist/index.js run inspect <uuid>
# or, if realm-cli is installed globally:
realm run inspect <uuid>
```

## Run it with an AI agent (any VS Code agent with MCP support)

**Step 1** — Build:
```bash
npm run build
```

**Step 2** — VS Code picks up `.vscode/mcp.json` automatically. The `realm-incident-response`
MCP server starts on first use — no `settings.json` editing required.

**Step 3** — In Copilot chat, ask:
> "Triage this alert with Realm: examples/03-incident-response/alerts/high-latency.json"

The workspace instruction file (`.github/instructions/realm.instructions.md`) gives your agent
the generic Realm protocol. The `skill.md` in this directory layers the workflow-specific
behaviour on top.

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

- [Example 2 — Document Intake](../02-document-intake/) — `on_error` branching, handler
  validation, revision loop
- [YAML Schema Reference](../../docs/reference/yaml-schema.md) — all step fields, execution
  modes, gate configuration, and transitions

