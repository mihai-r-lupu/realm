# Example 1 — Structured Code Review

## What this shows

A four-step, evidence-tracked code review. An auto step reads the source file via the
built-in `FileSystemAdapter` — the agent never sees the raw file path. The engine enforces step
order: security analysis must complete before quality assessment can run. Each agent step runs
with a dedicated persona loaded from `agents/` at register time — see **Agent profiles** below.
The agent receives its task at each step via `next_action.prompt`. A human gate requires explicit
approval before the run completes. Every step's input, output, and timing is captured in an
immutable evidence chain.

## Install

```bash
npm install  # from repo root — installs all workspace packages
```

## Run it (headless)

```bash
cd examples/code-review
npm run build
node dist/driver.js fixtures/findings-approved.yaml
```

Expected output:
```
Run: <uuid>
Workflow: Structured Code Review v1
Fixture: findings-approved

✓ review_security              —   findings=2
✓ assess_quality               —   findings=3   overall_risk=high
✓ confirm_review               —   choice=approve
─────────────────────────────────────────────────────────
Final state: completed
Evidence hash chain: ok (3/3)
```

Try the rejection fixture too:
```bash
node dist/driver.js fixtures/findings-rejected.yaml
```

To inspect the full evidence chain of any completed run, copy the `<uuid>` from the output and run:
```bash
node ../../packages/cli/dist/index.js inspect <uuid>
# or, if @sensigo/realm-cli is installed globally:
realm inspect <uuid>
```

## Run it with an AI agent (any VS Code agent with MCP support)

**Step 1** — Build:
```bash
npm run build
```

**Step 2** — VS Code picks up `.vscode/mcp.json` automatically. The `realm-code-review`
MCP server starts on first use — no `settings.json` editing required.

**Step 3** — In Copilot chat, ask:
> "Review this code with Realm: [paste your code]"

The workspace instruction file (`.github/instructions/realm.instructions.md`)
gives your existing agent the generic Realm protocol: discover workflows, read the step
protocol, and follow `next_action`. The code-review-specific skill (`skill.md` in this
directory) layers the workflow-specific behaviour on top.

If the tools don't appear in Copilot, see [examples/README.md](../README.md#troubleshooting-mcp--vs-code).

## Agent profiles

The two agent steps (`review_security`, `assess_quality`) each reference a dedicated persona file:

```
agents/
  security-reviewer.md   # loaded by review_security
  quality-reviewer.md    # loaded by assess_quality
```

Each profile defines the agent's role, scope, and constraints. At `realm register` time the engine
reads both files, computes a SHA-256 hash of each, and embeds the content in the workflow protocol
as `agent_profile_instructions`. The consuming agent receives the profile alongside the step's
`prompt`. The profile name and hash are recorded in the evidence snapshot — `realm inspect` shows
them in cyan after the step name.

---

## What to look at next

- [Example 2 — Document Intake](../document-intake/) — conditional branching with `on_error` and
  gate-response `transitions`, `FileSystemAdapter`, handler validation
- [Engine: step.prompt](../../packages/core/src/engine/prompt-template.ts) — the template resolver
  behind `next_action.prompt`
