# Realm Examples — Authoring Guide

> Apply these rules when building a new example or modifying an existing one.

## Purpose

The examples are the primary vehicle for demonstrating Realm to prospective users. Each example must:

- Tell a clear **before/after story**: before = a skill or prompt file that grew through real failures; after = a Realm workflow that enforces the same logic mechanically.
- Be fully self-contained and runnable in isolation.
- Ship with its own workflow definition, sample data, test fixtures, and README.

**Target reader:** a developer already building AI agent workflows (Copilot skills, `.agent.md` files, LangChain pipelines) who is hitting the reliability wall.

---

## What Realm Does and Does Not Do

These principles apply to every example. Never violate them.

**Realm does:**

- Enforce step order via a YAML state machine
- Validate step input schemas before execution
- Enforce human gates mechanically — not by agent goodwill
- Produce an immutable evidence chain for every run

**Realm does NOT do:**

- Parse or classify unstructured text — that is the LLM's job
- Make the agent smarter — it makes the agent's behaviour predictable
- Run domain logic in handlers — handlers are for deterministic operations only (schema validation, hash computation, verbatim-quote checking, field existence). If the logic requires language understanding, it belongs in an agent step.

---

## Design Constraints

Every example must satisfy all four:

1. **Zero credentials for the first run.** No API keys, no OAuth, no external services. A developer who just ran `npm install` can complete the example.
2. **Runnable in two modes:**
   - **Mode 1 — Live (MCP client):** the agent drives execution interactively; the human responds to human gate prompts.
   - **Mode 2 — Headless (driver script):** `node dist/driver.js <fixture>` drives the workflow programmatically. Exits 0 on success, prints the full evidence chain.
3. **Screen-recordable.** Terminal output must tell the story without narration. `realm run inspect <run-id>` output must be visually compelling on its own.
4. **Swap-ready.** Every mock adapter is declared in the YAML and wired at startup. Replacing a mock with a real service requires changing one env var. Zero YAML changes.

---

## Data Flow Rule

**Never rely on the agent's context window to carry prior step data forward.** Context windows compress, agents lose track of data buried in earlier tool responses, and behaviour varies across LLMs.

Always reference prior step output explicitly via `context.resources.STEP_NAME.FIELD` in `step.prompt`. The engine resolves these references against the immutable evidence chain before delivering the prompt — the agent receives the data at step entry, every time, regardless of what happened earlier in the conversation.

---

## Driver Script Pattern

All drivers follow the same five-step structure:

1. Load fixture file from the CLI argument
2. Initialise `InMemoryStore` + `ExtensionRegistry`; register adapters and handlers
3. Call `startRun(definition, params, { store, registry, secrets })`
4. Loop: call `executeChain` until terminal state; inject agent response from fixture when `status` is `agent_required`; inject gate response when `status` is `gate_waiting`
5. Print evidence chain table; exit 0 if `completed`, exit 1 otherwise

---

## README Pattern

Every example README must have exactly these five sections, in this order:

1. **What this shows** — one paragraph, no jargon
2. **Install** — `npm install` from repo root (that's it)
3. **Run it (headless)** — single command and exact expected terminal output
4. **Run it with an AI agent** — three steps: MCP config snippet, how to start the agent, what prompt to use
5. **What to look at next** — link to the next example + link to the most relevant documentation page

---

## Success Criteria

An example is complete when all of the following are true:

- [ ] `node dist/driver.js fixtures/happy-path.yaml` exits 0 and prints a valid evidence chain
- [ ] All fixture-based tests pass
- [ ] A developer who has never seen Realm can read the README and successfully run Mode 2 in under 5 minutes
- [ ] A developer can swap the mock adapter for a real one by changing one env var — no other changes
- [ ] `realm run inspect` on a completed run shows a compelling, human-readable audit trail

---

## Advanced Pattern: Agent-Generated Workflows

For open-ended tasks where the right step sequence is not known in advance, an agent can generate its own Realm workflow at runtime using the `create_workflow` MCP tool (already implemented). The agent analyses the request, emits a workflow definition tailored to it, then executes it step by step. Realm enforces the structure the agent itself designed — the agent cannot drift from its own plan mid-execution.

See `.github/instructions/realm-create-workflow.instructions.md` for the full protocol.
