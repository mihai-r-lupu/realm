# Example 1 — Structured Code Review

## What this shows

A three-step, evidence-tracked code review. The engine enforces step order: security analysis
must complete before quality assessment can run. The agent receives its task instruction
at each step via `next_action.prompt` — not from a static skill file. A human gate requires
explicit approval before the run completes. Every step's input, output, and timing is captured
in an immutable evidence chain.

Compare `skill.md` in this directory (8 lines) to the SKILL.md in the `before/` comments
at the top of `workflow.yaml`. That diff is Realm's value proposition.

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

## Run it with an AI agent (any VS Code agent with MCP support)

**Step 1** — Build:
```bash
npm run build
```

**Step 2** — VS Code picks up `.vscode/mcp.json` automatically. The `realm-code-review`
MCP server starts on first use — no `settings.json` editing required.

**Step 3** — In Copilot chat, ask:
> "Review this code with Realm: [paste your code]"

The workspace instruction file (`.github/instructions/realm-code-review.instructions.md`)
gives your existing agent the Realm protocol. It calls `start_run`, reads
`next_action.prompt` at each step, and presents the final report for your approval before
completing the run.

If the tools don't appear in Copilot, see [examples/README.md](../README.md#troubleshooting-mcp--vs-code).

## What to look at next

- [Example 2 — CHANGELOG Entry Extraction](../changelog-extract/) — adds a `FileSystemAdapter`
  and the `pipeline` field: fetch → normalize → hash → agent extracts → handler validates
- [Engine: step.prompt](../../packages/core/src/engine/prompt-template.ts) — the template resolver
  behind `next_action.prompt`
