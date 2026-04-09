# Realm — Examples

Examples are ordered by the developer pain they address, starting with the most immediately
felt problems. Each example has a **before** (the naive approach) and an **after** (the Realm
workflow), so you can see exactly what changes and why.

| Example                                        | Pain points demonstrated                                                           | Realm primitive                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [03-incident-response/](03-incident-response/) | No human gate before irreversible action, no audit trail, duplicate posts on retry | Human gate, idempotency via evidence chain, sequential agent steps with personas |
| [02-document-intake/](02-document-intake/)     | No output validation, steps proceed on bad data, no retry boundary                 | Handler schemas, `on_error` branching, validation step                           |

More examples covering verification gaps, checkpoint/resume, and idempotency are planned.
See `.private/realm-ai-automation-pain-points-final.md` for the full priority ladder.

Each example ships with a headless driver (`node dist/driver.js <fixture>`) and an MCP server
(`node dist/mcp-server.js`) for use with a VS Code agent.

---

## Setup

```bash
# From the repo root — installs all workspace packages including examples
npm install

# Build all examples at once
npm run build
```

Or build a single example:

```bash
cd examples/03-incident-response
npm run build
```

---

## Running with an AI agent (VS Code + Copilot)

The workspace `.vscode/mcp.json` registers MCP servers for all examples. VS Code starts the
relevant server automatically (`autoStart: true`) when the workspace opens.

In Copilot chat, refer to the example's README for the exact prompt to use.

---

## Troubleshooting MCP + VS Code

### Tools don't appear in Copilot chat

VS Code injects MCP tools into a chat session at the moment the session opens. If the server
was not running when you opened the conversation, the tools are absent for its entire lifetime.

**Fix:** Start a new chat session. Confirm the server is listed as **Running** first:

> Command Palette → **MCP: List Servers**

If the server shows as stopped, reload the window first:

> Command Palette → **Developer: Reload Window**

`autoStart: true` is set in `.vscode/mcp.json` so the server should start automatically on
window load. If it doesn't, confirm the example has been built:

```bash
cd examples/03-incident-response && npm run build
```

### "Falling back to a direct review" — agent ignores the Realm protocol

The agent's response appears in the chat, but it never called `start_run`. Two possible causes:

1. **Wrong agent mode** — make sure you are in **Master Architect** or **Implementation Agent**
   mode. Both have `realm-incident-response` in their `tools:` list. The default Copilot agent does not.
   Switch using the agent dropdown in the chat panel.

2. **Server not connected** — the tool exists in the agent's list but VS Code has not started the
   server process yet. Check **MCP: List Servers** and confirm the server is **Running**, then open
   a new chat session.

### Running in a WSL remote environment

The MCP server runs inside the WSL extension host. Ensure the example is built inside WSL (not on
the Windows host) and that `node` resolves to the WSL Node.js installation:

```bash
which node   # should print /usr/bin/node or similar — not a Windows path
```

VS Code starts the MCP server from the remote host automatically when `autoStart: true` is set.

### Server starts but tools still fail

Check whether `mcp-server.js` is in the built output:

```bash
ls examples/03-incident-response/dist/mcp-server.js
```

If missing, rebuild:

```bash
cd examples/03-incident-response && npm run build
```
