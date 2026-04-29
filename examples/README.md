# Realm — Examples

Examples are ordered by the developer pain they address, starting with the most immediately
felt problems. Each example has a **before** (the naive approach) and an **after** (the Realm
workflow), so you can see exactly what changes and why.

| Example                                              | Pain points demonstrated                                                           | Realm primitive                                                                            | Gate? |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----- |
| [01-code-reviewer/](01-code-reviewer/)               | Verification gap, non-determinism, instruction file spiral, no audit trail         | Workflow states as verification gates, `input_schema` enforcement                          |       |
| [02-ticket-classifier/](02-ticket-classifier/)       | Structured output failures, tool calling brittleness, hidden framework retry logic | Agent step `input_schema` enforcement, schema-driven `provide_input`                       |       |
| [03-incident-response/](03-incident-response/)       | No human gate before irreversible action, no audit trail, duplicate posts on retry | Human gate, idempotency via evidence chain, sequential agent steps                         | ⏸     |
| [04-content-pipeline/](04-content-pipeline/)         | State loss on failure, expensive full restart, no checkpoint recovery              | Checkpoint/resume, DAG execution model, `realm run resume` from any failed step            |       |
| [05-parallel-code-review/](05-parallel-code-review/) | Sequential bottleneck, non-determinism, verification gap across parallel branches  | DAG fan-out (`depends_on` on multiple predecessors), independent per-branch `input_schema` |       |

⏸ = example has a human gate. Slack gate modes (webhook notification, bidirectional thread reply, or Events API real-time push) apply to these examples. See [Slack Gate Modes](../docs/reference/realm-agent-slack.md) for setup.

More examples covering multi-agent coordination are planned.
See `.private/realm-ai-automation-pain-points-final.md` for the full priority ladder.

---

## Standalone agent execution

The following example demonstrates `realm agent` — the CLI path for running a workflow
autonomously without an MCP client or IDE. It requires no VS Code, no `.vscode/mcp.json`,
and no AI chat session. It is the reference for the `realm agent` execution model from
end to end: auto steps, agent steps, a human gate mid-run, and conditional branching based
on the gate choice.

| Example                  | What it demonstrates                                                                              | Gate?                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --- |
| [pr-review/](pr-review/) | Unreviewed changes posted to Slack, no approval gate before posting, no record of what was posted | `realm agent` end-to-end, human gate before irreversible action, conditional routing on gate choice | ⏸   |

---

## Setup

```bash
# From the repo root — installs all workspace packages
npm install
```

Copy the environment variable template and fill in your keys:

```bash
cp .env.example .env
# Edit .env and add at minimum OPENAI_API_KEY or ANTHROPIC_API_KEY
```

The CLI loads `.env` automatically when run from the repo root. No `export` needed.

No per-example build step is required. Examples use `realm mcp` and `realm workflow test`
directly from the installed CLI.

---

## Running with an AI agent (VS Code + Copilot)

The workspace `.vscode/mcp.json` starts a single `realm mcp` server automatically when the
workspace opens. Register the workflow you want to use:

```bash
# From the repo root:
realm workflow register examples/01-code-reviewer/workflow.yaml
realm workflow register examples/02-ticket-classifier/workflow.yaml
realm workflow register examples/03-incident-response/workflow.yaml
```

Then open (or restart) Copilot chat and refer to the example's README for the prompt to use.

---

## Running tests headlessly

Each example ships with test fixtures under `fixtures/`. Run them with:

```bash
realm workflow test examples/01-code-reviewer/workflow.yaml -f examples/01-code-reviewer/fixtures/
realm workflow test examples/02-ticket-classifier/workflow.yaml -f examples/02-ticket-classifier/fixtures/
realm workflow test examples/03-incident-response/workflow.yaml -f examples/03-incident-response/fixtures/
```

---

## Troubleshooting MCP + VS Code

### Tools don't appear in Copilot chat

VS Code injects MCP tools into a chat session at the moment the session opens. If the server
was not running when you opened the conversation, the tools are absent for its entire lifetime.

**Fix:** Start a new chat session. Confirm the server is listed as **Running** first:

> Command Palette → **MCP: List Servers**

If the server shows as stopped, reload the window:

> Command Palette → **Developer: Reload Window**

`autoStart: true` is set in `.vscode/mcp.json` so the `realm mcp` server starts automatically
on window load.

### "Falling back to a direct review" — agent ignores the Realm protocol

The agent's response appears in the chat, but it never called `start_run`. Two possible causes:

1. **Wrong agent mode** — make sure you are using an agent mode that has Realm tools in its
   `tools:` list. The default Copilot agent does not. Switch using the agent dropdown in the
   chat panel.

2. **Server not connected** — the tool exists in the agent's list but VS Code has not started the
   server process yet. Check **MCP: List Servers** and confirm the server is **Running**, then
   open a new chat session.

### Running in a WSL remote environment

The MCP server runs inside the WSL extension host. Ensure `node` resolves to the WSL Node.js
installation:

```bash
which node   # should print /usr/bin/node or similar — not a Windows path
```

VS Code starts the MCP server from the remote host automatically when `autoStart: true` is set.
