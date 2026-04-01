# Realm — Product Design Document

**Realm** — Reliable Agent Lifecycle Management

**Company:** Sensigo (`sensigo.dev`)
**Product:** Realm (`sensigo.dev/realm`)
**npm scope:** `@sensigo/realm-*`
**CLI binary:** `realm`
**GitHub:** `github.com/sensigo/realm`

The name "Realm" is an acronym: **R**eliable **E**xecution **A**gent **L**ifecycle **M**anagement. A realm is a kingdom you govern — the developer rules over their AI agent's execution, defining the boundaries, the steps, and the evidence requirements. The product creates a realm of verified, controlled AI execution.

## What This Document Covers

This document captures the full architectural exploration for a product that makes AI agents follow instructions reliably and shows you what they did. It includes:

- **Part 1:** The problem — how AI agents work today and why they fail at complex workflows
- **Part 2:** Ideas we explored — five architectural approaches, what was good and bad about each
- **Part 3:** The final architecture — product description, distribution channels, system diagram
- **Part 4:** The workflow engine — ResponseEnvelope, dual-guard model, execution loop, trust levels, evidence snapshots, structured next_action with auto-execution, step timeouts, retry and resume, input validation, error taxonomy, concurrency control, run lifecycle and retention, human gate mechanics, conditional branching, parallel execution, workflow composition, for_each/while loops, input_map with expression language, expression language specification, extensions, step templates
- **Part 5:** MCP server and skill file — how agents connect, six MCP tools, `get_workflow_protocol` response structure with full example, the bootstrap skill file
- **Part 6:** Resources and external services — trust levels for resources, hash verification, service definitions, adapters, processing pipelines, custom processors in cloud, handling large documents and RAG, Realm's position in the RAG ecosystem with auditable RAG pattern, integration ecosystem (8 categories, 20 adapters prioritized)
- **Part 7:** Workflow definition format — minimal and complete YAML examples, schema references, workflow registration, workflow versioning
- **Part 7b:** Outbound events and webhooks — event types (run, step, gate), webhook configuration, payload structure, custom body templates, delivery with retry, request signing, internal event bus architecture
- **Part 8:** Diagnostics and tuning — per-step diagnostics, the tuning loop, replay/dry-run
- **Part 8b:** Testing — five testing levels (validate, unit, integration with fixtures, replay, CI/CD), mock-able adapters, agent response injection, testing package
- **Part 9:** Build plan — tech choices, monorepo structure, phased timeline, open source strategy
- **Part 10:** The original agent proposal — the full proposal from the initial conversation and its critique
- **Part 11:** Decision log — every major decision with context and reasoning
- **Part 12:** Strategy notes — competition analysis, pricing evolution, launch strategy, positioning, CV impact
- **Part 13:** Cloud value proposition and plugin model — six cloud-only features, four plugin categories, project bundles, licensing model, revenue summary, local vs cloud comparison
- **Part 14:** Architecture model comparison — final model vs all earlier proposals, summary comparison table, unique contributions of the final model
- **Part 15:** Known weaknesses and mitigations — YAML complexity (progressive disclosure + defaults), engine monolith risk (internal module boundaries), missing testing story (test mode with fixtures and mock services)
- **Part 16:** Open questions — unresolved design and product questions
- **Part 17:** Pre-build clarifications — thirteen items to resolve before and during building, organized by urgency (5 must-address before building, 4 address during Phase 1-2, 4 address later)

---

## Part 1: The Problem

### How AI agents work today

AI agents (Claude, OpenAI, OpenClaw, etc.) operate based on:

1. **Chat history and prompt injection.** The agent reads the conversation so far and follows instructions injected into its context. This is unreliable for multi-step workflows because the agent can lose track of where it is, skip steps, or get distracted by unrelated conversation.

2. **MCP tools (Model Context Protocol).** Agents can call external tools through MCP, but only if specifically instructed. Having the tool available doesn't mean the agent will use it correctly — or at all.

3. **Local tools.** Agents have access to file system tools, code execution, etc. But they're pretrained to prefer certain tools and may ignore others even when they're available and appropriate.

4. **Skill files.** Agents reliably follow skill files — markdown documents that describe what to do and how to do it. But skill files only work well when the instructions are simple, strict, and linear. Complex workflows with branching, validation, and multi-step state management are too much for a skill file alone.

### The core problem

If you want an AI agent to perform a complex workflow — extract fields from a document, validate them, write them to a database — you need to:

- **Guide them:** tell them exactly what to do at each step, what information to use, and what to produce
- **Guard them:** prevent them from skipping steps, going backwards, or doing things out of order
- **Verify them:** check their work — directly, or by asking them to check their own results against evidence
- **Track them:** record every step they took, what they received, what they produced, what evidence they presented — so you can see exactly where things went wrong and tune the workflow for better results

No existing tool provides all four of these together. LangGraph orchestrates steps but doesn't verify outputs. Temporal retries failures but doesn't track evidence. Prompt chaining is fragile and opaque. The developer's only debugging tool today is "read the prompt and guess what went wrong."

### The origin: the clozr playbook updater

This product idea came from a real client project: extracting fields from property management playbook documents (Google Docs) and writing the extracted values into a Bubble database. The developer built a Python CLI app that:

- Defines a 12-step workflow (create run → validate target → fetch document → verify identity → check branding → extract fields → validate quotes → confirm with user → write to database → post to Slack)
- Uses a state machine to prevent the agent from executing steps out of order
- Returns a `next_action` field in every response that tells the agent exactly what to do next, in plain English
- Validates extraction results by checking that every extracted value has a verbatim quote that actually appears in the source document
- Records a full audit trail including extraction traces (which cues were tried, which matched, which sections were scanned)

This app works — it makes the AI agent reliable for this specific workflow. The product idea is to generalize this pattern so anyone can build similar guided, verified, observable workflows for any AI agent task.

---

## Part 2: Ideas We Explored

### Idea 1: MCP server wrapping the state machine

**What it was:** Take the Python state machine and expose it as an MCP server so any agent can connect to it.

**Why we rejected it:** MCP is a tool-access protocol — it lets agents call functions. But the problem here is the opposite: we don't want the agent to decide when to call state management commands. We want the state machine to drive the agent. MCP is passive (the agent initiates calls); the pattern requires the system to be directive (telling the agent what to do next). Wrapping this as an MCP server would weaken the pattern by making flow control the agent's responsibility again.

**What we kept:** MCP is still the right *transport layer* — it's how the agent connects to the system and sends/receives commands. But the system behind the MCP server is what drives the workflow, not the agent.

### Idea 2: HTTP session manager API

**What it was:** A REST API with `POST /sessions`, `POST /sessions/{id}/step`, and `GET /sessions/{id}`. The original agent proposed this as a Cloudflare Workers + Durable Objects deployment in TypeScript.

**What was good:** The API surface is clean. The three-route contract is simple and sufficient.

**What was wrong:**
- Durable Objects are architecturally sound but add unnecessary learning curve when a Postgres table does the same job at current scale
- The proposal jumped to infrastructure (Cloudflare, Durable Objects, Stripe billing) before validating that anyone wants the product
- The context delivery mechanism was overengineered (five different methods: context_inject, context_url, context_handle, context_summary, context_reminder)

**What we kept:** The API surface design. The concept of the session store that accumulates state across steps.

### Idea 3: Realm Protocol

**What it was:** A more ambitious architecture that reframed the state machine as a "trust protocol between humans and AI agents." Core primitives:

- **VerifiedAction**: a unit of work with preconditions, evidence requirements, and a trust level
- **Evidence Chain**: a linked list of evidence nodes that proves every value written to production was derived from a verified source through validated steps
- **Trust Levels**: a spectrum from `auto` (no human involvement) to `human_reviewed` (human inspects evidence, not just clicks confirm)
- **Context Contracts**: each step declares what it reads and writes, and the runtime assembles exactly what the step needs

**What was good:** The evidence chain is genuinely novel — no existing AI workflow tool produces a verifiable audit trail that traces a database write back to the exact quote in the exact document with the exact hash. The trust levels are a cleaner model than binary confirm/don't-confirm.

**What was wrong:** The abstraction was too heavy. Terms like "VerifiedAction" and "Evidence Chain" and "Context Contracts" are implementation details, not the product. The proposal also tried to generalize too early — building abstract "verified components" before having a second workflow to test the abstractions against.

**What we kept:** The evidence chain concept (as "evidence snapshots" per step). The trust levels. The insight that precondition-based guards are better than positional state checks.

### Idea 4: Composable component platform

**What it was:** A platform where developers compose workflows from configurable, reusable components. Three layers: Component SDK (for building new components), Workflow definitions (YAML/JSON for wiring components together), Schema definitions (domain-specific field configurations).

**What was good:** The layered model is right. Separating "what the steps do" (components) from "what order they run in" (workflow definition) from "what domain data they work with" (schemas) is a clean separation of concerns.

**What was wrong:** It assumed developers would want to compose abstract components. In practice, the valuable thing is the specific, opinionated guidance (the `next_action` strings), not the composability. Also, YAML workflow definitions can't express the kind of business logic that real steps contain (80+ lines of regex matching and fuzzy scoring in validation alone).

**What we kept:** The three-layer model. The idea that workflows are configuration (YAML/JSON) for the flow graph, but step implementations are code.

### Idea 5: Debuggable AI execution environment

**What it was:** A reframing where the primary user is the AI agent (executor) and the developer is the debugger/tuner. The developer defines a workflow, the agent executes it, and when things go wrong the developer opens the logs, sees exactly where and why the agent failed, and tweaks specific parameters (confidence thresholds, cue lists, section allowlists) rather than rewriting prompts.

**What was good:** This is the correct framing. The key insight: the product isn't "build AI workflows" (developers can do that with duct tape). The product is "run AI workflows with full visibility into why the agent did what it did, and tune it without prompt engineering."

**What was wrong:** Nothing fundamental — this became the basis for the final architecture.

**What we kept:** Everything. This is the product.

---

## Part 3: The Final Architecture

### Product description (plain language)

A toolkit for making AI agents follow instructions reliably and showing you what they did. It does three things:

1. **Workflow definition.** You describe a process as a series of steps. Each step says what the agent should do (in plain English), what information it needs, what it should produce, and what happens next.

2. **Execution guardrails.** When the agent runs the workflow, the system makes sure it follows the steps in order. It won't let the agent skip ahead or go backwards. At each step, it hands the agent exactly the information it needs and tells it exactly what to do next. If a step requires a human to check something, the system stops and waits.

3. **Full visibility.** Every step the agent takes is recorded — what it received, what it produced, what decisions it made, what evidence it provided. When something goes wrong, the developer sees exactly where the agent went off track, adjusts the workflow, and runs it again.

### Distribution channels

The same core engine, two ways to use it:

1. **npm package (open source):** `npm install @sensigo/realm`. Developers install it, define workflows locally, run them from the CLI or connect agents via MCP. This is the adoption channel.

2. **Cloud app (paid service):** A hosted web application with a dashboard for inspecting runs, a workflow editor, log querying endpoints, and API endpoints for remote agents. Eventually includes AI-driven workflow creation via chat. This is the revenue channel.

### How the pieces connect

```
Developer's machine                          Cloud (later)
┌─────────────────────────┐                  ┌──────────────────┐
│                         │                  │                  │
│  Skill file (bootstrap) │                  │  Web dashboard   │
│  "connect to MCP at..." │                  │  Log viewer      │
│         │               │                  │  Workflow editor  │
│         ▼               │                  │  API endpoints   │
│  AI Agent (Claude, etc) │                  │       │          │
│         │               │                  │       ▼          │
│    MCP protocol         │                  │  Workflow Engine  │
│         │               │                  │  (same core)     │
│         ▼               │                  │       │          │
│  MCP Server             │                  │       ▼          │
│         │               │                  │  Postgres store  │
│         ▼               │                  │                  │
│  Workflow Engine (core) │                  └──────────────────┘
│         │               │
│         ▼               │
│  JSON file store        │
│  (runs/ directory)      │
│                         │
└─────────────────────────┘
```

---

## Part 4: The Workflow Engine (Core)

### The ResponseEnvelope

The most important data structure in the system. Every step returns one. Every agent interaction is shaped by one. Ported from the Python app's existing `ResponseEnvelope`:

```
ResponseEnvelope:
  command: string          # which step was executed
  run_id: string           # identifies this workflow run
  snapshot_id: string      # versioning for optimistic concurrency
  status: string           # "ok" | "confirm_required" | "blocked" | "error" | "warning"
  data: object             # step-specific output
  evidence: object         # what was captured for audit (inputs, outputs, hashes)
  warnings: string[]       # non-blocking issues
  errors: string[]         # blocking issues
  next_action: string      # plain English instruction for the agent
```

The `next_action` field is the killer feature. It tells the agent exactly what to do next, in specific language: "Call execute_step with command 'fetch_document'" or "EXTRACT NOW. You have 22 fields to find. Do NOT launch a sub-agent." The agent doesn't decide what's next — the engine decides and the agent follows.

### The dual-guard model (positional states + preconditions)

The engine uses two layers of guards to prevent steps from executing when they shouldn't. Both layers work together: the positional guard is the fast path, the precondition guard is the intelligence layer.

**Layer 1: Positional state guard (fast path)**

Each step declares which states it can execute from. The engine checks: "Is the current state in the `allowed_from_states` set?" This is a set lookup — O(1), trivially fast, never wrong. It handles 95% of cases in the normal flow where the agent follows `next_action` correctly.

```yaml
steps:
  fetch_document:
    allowed_from_states: [schema_checked, document_pending]
```

If the current state is in the set, the step proceeds. The positional guard is not a guide for the agent — the agent doesn't see the state machine or reason about it. It's an internal safety net that prevents the run state from degrading.

**Layer 2: Precondition guard (semantic path)**

Each step can also declare preconditions — checks against the actual run record that verify specific facts have been established, not just that the run is in a particular state string. Preconditions are evaluated when the positional guard fails, or optionally on every call for critical steps.

```yaml
steps:
  fetch_document:
    allowed_from_states: [schema_checked, document_pending]
    preconditions:
      - check: run.target_validation.status == "confirmed"
        explanation: "Target record must be validated"
        auto_resolve: validate_target
      - check: run.schema_prechecks.status == "passed"
        explanation: "Schema prechecks must pass"
        auto_resolve: run_schema_prechecks
```

Preconditions are richer than positional states in three ways:

First, error messages are always accurate because they're computed from the actual run state. The engine doesn't say "target must be validated" because someone wrote that text — it says it because it checked `run.target_validation.status` and found it missing.

Second, auto-resolution is precise. Each precondition can name a step that resolves it (`auto_resolve`). If `target_validation` passed but `schema_prechecks` didn't, the engine only runs `run_schema_prechecks`. It doesn't re-run everything from the last completed state.

Third, preconditions handle non-linear workflows naturally. In a workflow with parallel steps and conditional branches, the positional state can only be one value at a time. But preconditions can check multiple independent facts: "Has the document been fetched AND has the identity been verified AND has the branding check passed?" Each is a separate check against the run record.

**How the two layers work together:**

```
Agent calls execute_step with command "fetch_document"

Step 1: Positional guard (fast path)
  Current state: "schema_checked"
  Allowed states: [schema_checked, document_pending]
  Result: PASS → execute the step, skip preconditions
  (This is the normal case — 95% of calls end here)

--- OR ---

Step 1: Positional guard (fast path)
  Current state: "run_created"
  Allowed states: [schema_checked, document_pending]
  Result: FAIL → evaluate preconditions

Step 2: Precondition guard (semantic path)
  Check: run.target_validation.status == "confirmed"
  Result: FAIL — target_validation not found in run record
  auto_resolve: validate_target (and validate_target is auto-execution)
  → Engine runs validate_target internally

  Check: run.schema_prechecks.status == "passed"
  Result: FAIL — schema_prechecks not found
  auto_resolve: run_schema_prechecks (auto-execution)
  → Engine runs run_schema_prechecks internally

  All preconditions now satisfied
  → Engine executes fetch_document

Step 3: Return to agent
  ResponseEnvelope includes evidence from all three steps
  (validate_target, run_schema_prechecks, fetch_document)
  Agent asked for one step and got three — but only needed one round-trip
```

**The precondition expression language:**

Simple, not a full programming language. Supports path lookups into the run record and basic comparisons:

```
run.target_validation.status == "confirmed"     # equality
run.document_hash exists                         # existence
run.schema_prechecks.excluded_count < 5          # numeric comparison
run.candidates.length > 0                        # array length
run.identity_result.confidence_score >= 70       # threshold check
```

The expression evaluator is roughly 100-150 lines of TypeScript. It parses dot-separated paths, resolves them against the run record JSON, and evaluates the comparison. No variables, no function calls, no loops — just path lookups and comparisons.

**When to use which:**

Simple linear workflows (most workflows at launch): just use `allowed_from_states`. No preconditions needed. The positional guard is sufficient and the overhead is zero.

Complex workflows with parallel steps: add preconditions for steps that depend on multiple parallel branches completing. The positional state can only represent one branch's completion; preconditions can check all of them.

Workflows with resume scenarios: add preconditions for steps that might be re-entered after a failure and resume. The preconditions verify that prerequisites are actually satisfied in the run record, not just that the state string looks right.

Workflows with auto-resolution: add preconditions with `auto_resolve` for steps where the engine should automatically run missing prerequisites instead of returning a block error. Most useful in combination with auto-execution mode.

**The blocked response with dual guards:**

When both guards fail and auto-resolution isn't configured (or the auto-resolve steps are agent-execution), the engine returns a rich error:

```json
{
  "status": "blocked",
  "errors": ["command fetch_document not allowed in current state"],
  "blocked_reason": {
    "current_state": "run_created",
    "allowed_states": ["schema_checked", "document_pending"],
    "failed_preconditions": [
      {
        "check": "run.target_validation.status == confirmed",
        "explanation": "Target record must be validated",
        "resolve_by": "Call validate_target"
      },
      {
        "check": "run.schema_prechecks.status == passed",
        "explanation": "Schema prechecks must pass",
        "resolve_by": "Call run_schema_prechecks"
      }
    ],
    "suggestion": "Call validate_target first, then run_schema_prechecks, then retry fetch_document"
  }
}
```

For AI agents, this is powerful. Instead of "blocked in state X" (requiring the agent to reason about state transitions), the agent gets specific instructions: "call validate_target first, then run_schema_prechecks." The agent follows the `suggestion` directly without understanding the state machine.

### The execution loop

Every agent interaction follows the same pattern:

```
1. Agent calls MCP tool "execute_step"
   with: { run_id, command, params }

2. MCP Server passes the call to the Workflow Engine

3. Engine loads the run state from the store
   (JSON file locally, database row in cloud)

4. Engine checks positional guard: is this command allowed
   in the current state?
   YES → skip to step 6
   NO  → continue to step 5

5. Engine evaluates preconditions (if defined for this step):
   All satisfied → continue to step 6
   Some failed + auto_resolve configured → run prerequisites
   internally, then continue to step 6
   Some failed + no auto_resolve → return { status: "blocked" }
   with failed_preconditions and suggestion

6. Engine validates input params against step's input schema
   FAIL → return { status: "error" } with validation details
   PASS → continue

7. Engine assembles the context this step needs
   (document text, schema fields, previous step outputs)

8. Engine executes the step logic

9. Engine captures evidence
   (inputs, outputs, hashes, timestamps)

10. Engine updates the run state in the store

11. Engine returns ResponseEnvelope with next_action

12. Agent reads next_action and follows it
```

### Trust levels

Each step declares how much human involvement is required:

- **auto**: the system proceeds without human involvement. Example: schema prechecks where Bubble-only drift is always excluded.
- **human_notified**: proceeds automatically but the human is told what happened. Example: identity verification with score 100 (exact match).
- **human_confirmed**: hard gate — human must approve before proceeding. Example: writing extracted values to the database. The engine returns `status: "confirm_required"`, the agent shows the preview to the user, and the workflow pauses until the human responds.
- **human_reviewed**: human must inspect the evidence, not just click confirm. Example: branding mismatch where a different company's name was found in the document.

### Evidence snapshots

Every step that interacts with external data captures a snapshot in the run record. This serves the audit trail — you can always see exactly what was used, when, and what state it was in.

Evidence snapshot structure:
```
{
  resource: "document_source",
  source: "https://docs.google.com/document/d/abc123",
  snapshot_hash: "sha256:abc789...",
  snapshot_content: "the full normalized text",
  captured_at: "2025-03-30T14:22:00Z",
  fetched_by: "engine",
  processing_pipeline: [
    { processor: "pdf_to_markdown", input_size: 284000, output_size: 35200 },
    { processor: "normalize_text", changes: ["smart_quotes: 14", "dashes: 3"] },
    { processor: "compute_hash", hash: "sha256:abc789..." }
  ]
}
```

### Structured next_action and auto-execution mode

The `next_action` field in the ResponseEnvelope should be a structured object, not just a plain string. A plain string like "Call execute_step with command 'fetch_document'" is readable by the agent but the engine can't programmatically verify the agent followed it. Making it structured enables both agent-readable guidance and machine-readable auto-execution.

Structured next_action format:
```json
{
  "next_action": {
    "instruction": {
      "tool": "execute_step",
      "params": {
        "run_id": "abc-123",
        "command": "fetch_document"
      }
    },
    "human_readable": "Call execute_step with command 'fetch_document'",
    "context_hint": "The target record has been validated. Now fetch the source document.",
    "expected_timeout": "60s"
  }
}
```

The `instruction` field can be directly mapped to an MCP tool call. The `human_readable` field is what the agent reads and shows the user if needed. The `context_hint` explains why this step is next (useful for the agent's reasoning). The `expected_timeout` tells the agent how long the engine will wait.

**Auto-execution mode:** This structured format enables a mode where the MCP server reads the `instruction` field and automatically calls the next step without the agent needing to parse the string. Many workflow steps are purely engine-side work (fetch document, validate target, run prechecks) — the agent is just a relay passing commands through. In auto mode, the engine skips the relay and executes these steps internally.

Three execution modes, configurable per workflow and overridable per step:

```yaml
workflow:
  execution_mode: hybrid    # default — per-step override

steps:
  validate_target:
    execution: auto         # engine executes internally, no agent round-trip
  fetch_document:
    execution: auto         # engine executes internally
  build_extraction_input:
    execution: auto         # engine assembles the payload
  extract_candidates:
    execution: agent        # agent must do this work (LLM extraction)
  store_candidates:
    execution: agent        # agent submits results
  validate_candidates:
    execution: auto         # engine validates internally
  confirm_update:
    execution: agent        # requires human interaction via agent
  persist_update:
    execution: auto         # engine writes to database
```

In the clozr workflow, 9 of 12 steps are engine-side work. In hybrid mode, when the agent calls `start_run`, the engine runs `validate_target`, `fetch_document`, and `build_extraction_input` all internally, and only returns control to the agent at `extract_candidates` — the first step that actually needs the agent. This dramatically reduces round-trips and eliminates entire classes of "agent called the wrong step" errors.

When multiple auto steps execute sequentially, the engine chains them internally and returns the final result to the agent with a combined evidence trail showing what happened at each auto step.

### Step timeouts and stale run detection

The engine sends `next_action` and then waits for the agent to call back. If the agent crashes, the user closes the chat, or the agent gets distracted — the engine has no idea. The run sits in a non-terminal state forever.

Each step declares a timeout — how long the engine waits before considering the step abandoned:

```yaml
steps:
  validate_target:
    timeout: 30s                    # simple engine operation
    on_timeout: abandon

  fetch_document:
    timeout: 60s                    # network call
    on_timeout: abandon

  build_extraction_input:
    timeout: 300s                   # agent does heavy extraction work
    on_timeout: warn_and_wait       # log warning but keep run open

  confirm_field_update:
    timeout: 24h                    # human gate — give them a day
    on_timeout: abandon
    on_timeout_notify: webhook      # tell the developer
```

When a timeout fires, the engine transitions to a `step_timed_out` state that records which step timed out and what the agent was supposed to do. Behavior is configurable:

- `abandon` — mark the run as abandoned. Clean terminal state.
- `warn_and_wait` — log a warning in the evidence chain, keep the run open. If the agent calls back later, accept it with a warning.
- `reject_late` — if the agent calls back after timeout, reject the call with an error (strict mode).

For the cloud version, the engine can send notifications when steps time out — a webhook, email, or Slack message to the developer: "Run abc-123 stalled at step fetch_document. The agent hasn't called back in 5 minutes."

For auto-execution steps, timeouts apply to the engine's own execution (e.g., a network call that hangs). The engine applies the timeout internally and handles the failure via the retry policy.

### Step-level retry and run resume

In the current design, if a step fails (network error, API returns 500), the run is stuck. The only option is to start a new run from scratch, re-executing all previous steps even though they succeeded.

**Retry policies:** Each step can declare a retry policy for transient failures:

```yaml
steps:
  fetch_document:
    retry:
      max_attempts: 3
      backoff: exponential          # 1s, 2s, 4s
      retryable_errors: [network_error, http_5xx, timeout]
    on_permanent_failure: block_and_report
```

When a retryable error occurs, the engine doesn't return the error to the agent immediately. It waits, retries internally, and only surfaces the error if all retries are exhausted. The agent never knows the retry happened — it sees either success or a final failure. The evidence chain records every attempt, including the failed ones, with timestamps and error details.

For non-retryable errors (wrong document URL, authentication failure, validation rejection), the engine returns the error immediately without retrying.

**Run resume:** Beyond retries, the engine supports resuming a failed run from the step that failed:

```
MCP tool: resume_run(run_id, from_step, updated_params)
  → validates that the run is in a failed or timed_out state
  → validates that from_step is the step that failed
     (or a step after the last successful step)
  → re-executes from that step forward
  → previous step evidence is preserved intact
  → new execution appends to the evidence chain
```

If `fetch_document` failed after `validate_target` succeeded, the developer fixes the URL and calls `resume_run` from `fetch_document`. The engine checks that the run is in the right state, updates the document URL parameter, and continues — without re-running target validation.

The evidence chain shows the original failure, the resume point, and the new execution path. This gives complete audit visibility even for runs that needed manual intervention.

### Input schema validation per step

When the agent calls `execute_step` with params, the engine currently trusts whatever the agent sends. If a step expects a `candidates` array and the agent sends a string, or if it expects a `document_hash` and the agent forgets to include it, the step fails at some unpredictable point in its logic with an unclear error.

Each step declares an input schema — a JSON Schema that describes required params and their types. The engine validates the agent's input before executing the step:

```yaml
steps:
  store_candidates:
    input_schema:
      required: [candidates, document_hash]
      properties:
        candidates:
          type: array
          items:
            required: [field_id, value, verbatim_quote]
            properties:
              field_id: { type: string }
              value: { type: string }
              verbatim_quote: { type: string }
              confidence: { type: number, minimum: 0, maximum: 1 }
              source_section: { type: string }
        document_hash:
          type: string
          pattern: "^sha256:"
        extraction_trace:
          type: array
```

If the agent's input doesn't match the schema, the engine returns an immediate, clear error before any step logic runs: "store_candidates requires 'candidates' (array) but received a string. Required fields per candidate: field_id, value, verbatim_quote."

This catches malformed input early and gives the agent a specific error to fix, instead of a cryptic failure deep in the step implementation.

The schema also serves as documentation — the agent can call a `describe_step` MCP tool to see what inputs a step expects, with types, required fields, and examples. This helps the agent construct correct params without trial and error.

### Error taxonomy and structured error handling

Three consumers need errors from the engine, each needing different things:

- **The AI agent** needs to decide instantly: retry, fix input, ask the user, or stop. It can't parse English error messages reliably. It needs a machine-readable code and an action hint.
- **The engine's retry logic** needs to know: is this error transient (retry might help) or permanent (retrying is pointless)? A binary classification made on every error before the agent sees it.
- **The developer reading logs** needs the full story: what failed, what step, what inputs, what service, what HTTP status code.

**The error object structure:**

```typescript
interface WorkflowError {
  // Machine-readable — for the agent and engine
  code: string                    // e.g., "SERVICE_TIMEOUT"
  category: ErrorCategory         // which family this belongs to
  retryable: boolean              // can the engine retry automatically?

  // Agent-actionable — tells the agent what to do
  agent_action: AgentAction       // what the agent should do with this error
  agent_message: string           // plain English for the agent

  // Developer-readable — for logs and diagnostics
  message: string                 // human-readable description
  details: Record<string, any>    // step-specific context (url, status, response, attempt)

  // Trace — where and when
  step_id: string                 // which step produced the error
  timestamp: string               // when it happened
  attempt: number                 // which retry attempt (1 = first try)
}
```

**Error categories and codes:**

```
Category: NETWORK
  Default: retryable=true, agent_action="report_to_user"
  Codes:
    NETWORK_TIMEOUT           — connection or read timed out
    NETWORK_UNREACHABLE       — host not reachable
    NETWORK_DNS_FAILED        — DNS resolution failed
    NETWORK_CONNECTION_RESET  — connection dropped mid-request

Category: SERVICE
  Default: retryable=varies by code, agent_action="report_to_user"
  Codes:
    SERVICE_HTTP_4XX          — client error (retryable=false)
    SERVICE_HTTP_5XX          — server error (retryable=true)
    SERVICE_RATE_LIMITED      — rate limit hit (retryable=true, with backoff)
    SERVICE_AUTH_FAILED       — authentication rejected (retryable=false)
    SERVICE_NOT_FOUND         — resource not found / 404 (retryable=false)
    SERVICE_RESPONSE_INVALID  — response couldn't be parsed (retryable=false)

Category: STATE
  Default: retryable=false, agent_action="resolve_precondition" or "report_to_user"
  Codes:
    STATE_BLOCKED             — step not allowed in current state
    STATE_PRECONDITION_FAILED — precondition check failed
    STATE_RUN_NOT_FOUND       — run_id doesn't exist
    STATE_RUN_TERMINAL        — run already completed/cancelled/failed
    STATE_SNAPSHOT_MISMATCH   — optimistic concurrency conflict
    STATE_RUN_LOCKED          — another operation in progress on this run

Category: VALIDATION
  Default: retryable=false, agent_action="provide_input"
  Codes:
    VALIDATION_INPUT_SCHEMA   — params don't match step's input schema
    VALIDATION_HASH_MISMATCH  — agent's document hash doesn't match engine's
    VALIDATION_QUOTE_NOT_FOUND — verbatim quote not in source document
    VALIDATION_FIELD_UNKNOWN  — field_id not in schema
    VALIDATION_FIELD_EXCLUDED — field excluded by prechecks
    VALIDATION_EMPTY_VALUE    — candidate has empty value

Category: ENGINE
  Default: retryable=false, agent_action="stop"
  Codes:
    ENGINE_INTERNAL           — unexpected engine error (bug)
    ENGINE_STORE_FAILED       — couldn't read/write run record
    ENGINE_ADAPTER_FAILED     — service adapter threw unexpected error
    ENGINE_PROCESSOR_FAILED   — processing pipeline step threw
    ENGINE_HANDLER_FAILED     — step handler threw unexpected error
    ENGINE_TIMEOUT            — step exceeded its declared timeout

Category: RESOURCE
  Default: retryable=varies by code, agent_action="report_to_user"
  Codes:
    RESOURCE_FETCH_FAILED     — engine couldn't fetch a resource (retryable=true)
    RESOURCE_TOO_LARGE        — document exceeds max size limit (retryable=false)
    RESOURCE_FORMAT_INVALID   — document couldn't be parsed/converted (retryable=false)
    RESOURCE_NOT_ACCESSIBLE   — URL exists but access denied (retryable=false)
```

**The `agent_action` field — what the agent should do:**

The agent only sees errors that have already passed through the engine's retry logic. If the engine had a retry policy for `SERVICE_HTTP_5XX` and all retries were exhausted, the agent gets the final error. So `agent_action` is always about what to do after the engine has already tried its best.

`report_to_user` — tell the user what happened. This error can't be fixed by the agent. Example: database API is down, authentication failed, a resource was not found. The agent shows the error and waits for guidance.

`provide_input` — the agent sent something wrong. Fix the input and try again. Example: params didn't match the schema, document hash didn't match, a field_id wasn't recognized. The error details tell the agent exactly what was wrong. The agent can self-correct and re-call the step without user involvement.

`resolve_precondition` — a precondition wasn't met. The error includes which precondition failed and how to resolve it. The agent reads the `blocked_reason.failed_preconditions` and follows the suggestion. Connects directly to the dual-guard model.

`stop` — something is fundamentally wrong. Don't retry, don't try to fix it, stop and report. Example: engine internal error, store corruption, unexpected exception.

`wait_for_human` — this requires a human decision the agent can't make. Example: a human gate was triggered, or a trust level requires human review. The agent presents the situation to the user and waits.

**How errors flow through the system:**

```
Step fails (e.g., Bubble API returns HTTP 503)

1. Step implementation returns error with code: SERVICE_HTTP_5XX

2. Engine's error handler catches it
   Looks up: SERVICE_HTTP_5XX → category SERVICE, retryable=true

3. Engine checks retry policy for this step:
   max_attempts: 3, retryable_errors: [NETWORK_*, SERVICE_HTTP_5XX]
   Current attempt: 1 of 3 → retry internally
   Attempt 2: still 503 → retry
   Attempt 3: still 503 → all retries exhausted

4. Engine builds the error object for the agent:
   {
     code: "SERVICE_HTTP_5XX",
     category: "SERVICE",
     retryable: true,
     agent_action: "report_to_user",
     agent_message: "The database API returned a server error
                     (HTTP 503) after 3 attempts. This is likely
                     a temporary outage.",
     message: "Bubble API returned HTTP 503 Service Unavailable",
     details: {
       service: "database",
       operation: "write_fields",
       url: "https://app.bubble.io/api/1.1/obj/playbook/rec123",
       http_status: 503,
       attempts: 3,
       first_attempt_at: "2025-03-30T14:22:00Z",
       last_attempt_at: "2025-03-30T14:22:06Z"
     },
     step_id: "persist_update",
     timestamp: "2025-03-30T14:22:06Z",
     attempt: 3
   }

5. Engine returns ResponseEnvelope:
   {
     status: "error",
     errors: [the error object above],
     next_action: {
       instruction: null,
       human_readable: "The database API is unavailable.
                        Report this to the user.",
       context_hint: "All 3 retry attempts failed with HTTP 503."
     }
   }

6. Agent reads agent_action: "report_to_user"
   Agent tells user: "The database API returned a server error
   after 3 attempts. Want me to try again later?"
```

**The `provide_input` flow — agent self-corrects without user involvement:**

```
Agent calls store_candidates with malformed params

1. Engine validates input against step's input schema
   Field "candidates" expected array, got string

2. Engine builds error (no retry — validation error):
   {
     code: "VALIDATION_INPUT_SCHEMA",
     category: "VALIDATION",
     retryable: false,
     agent_action: "provide_input",
     agent_message: "The 'candidates' field must be an array
                     but you sent a string. Fix the input and
                     call store_candidates again.",
     details: {
       field: "candidates",
       expected: "array",
       received: "string",
       schema_path: "params.candidates"
     }
   }

3. Agent reads agent_action: "provide_input"
   Agent reads details: field "candidates", expected "array"
   Agent fixes the input, calls store_candidates again
   (No user involvement — agent self-corrected)
```

**How errors appear in the evidence chain:**

Every error is recorded, including retried attempts that the agent never saw:

```json
{
  "step": "persist_update",
  "attempts": [
    {
      "attempt": 1,
      "timestamp": "2025-03-30T14:22:00Z",
      "error": { "code": "SERVICE_HTTP_5XX", "http_status": 503 },
      "retried": true
    },
    {
      "attempt": 2,
      "timestamp": "2025-03-30T14:22:02Z",
      "error": { "code": "SERVICE_HTTP_5XX", "http_status": 503 },
      "retried": true
    },
    {
      "attempt": 3,
      "timestamp": "2025-03-30T14:22:06Z",
      "error": { "code": "SERVICE_HTTP_5XX", "http_status": 503 },
      "retried": false,
      "surfaced_to_agent": true
    }
  ]
}
```

The developer sees: three attempts, all failed with 503, spaced 2s apart (exponential backoff), final error surfaced to agent. For cloud cross-run analytics: "78% of persist_update failures last month were SERVICE_HTTP_5XX, concentrated between 2-4am UTC — likely Bubble's maintenance window."

**Errors from extensions (adapters, processors, step handlers):**

When an extension throws an unexpected error, the engine wraps it:

```
Adapter throws: TypeError: Cannot read property 'response' of undefined

Engine wraps as:
{
  code: "ENGINE_ADAPTER_FAILED",
  category: "ENGINE",
  agent_action: "stop",
  message: "Service adapter 'bubble' threw an unexpected error",
  details: {
    adapter_id: "bubble",
    operation: "write_fields",
    original_error: "TypeError: Cannot read property 'response' of undefined",
    stack_trace: "..."    // for developer logs, not shown to agent
  }
}
```

Extensions can also throw structured errors intentionally using the `WorkflowError` class:

```typescript
import { WorkflowError } from '@sensigo/realm'

const validateFields: StepHandler = {
  id: 'validate_extracted_fields',
  async execute(inputs, context) {
    if (inputs.params.candidates.length === 0) {
      throw new WorkflowError({
        code: 'VALIDATION_EMPTY_VALUE',
        agent_action: 'report_to_user',
        message: 'No candidates were submitted for validation',
        details: { expected: 'at least 1 candidate' }
      })
    }
    // ... validation logic
  }
}
```

The engine recognizes `WorkflowError` instances and uses them as-is (adding step_id and timestamp). Unrecognized errors get wrapped in the appropriate `ENGINE_*_FAILED` code.

### Concurrency control and run locking

Concurrent access to a run record can corrupt state. Four scenarios exist: an agent retries a timed-out call while the engine is still executing the first attempt, two agents (or browser tabs) drive the same run simultaneously, an auto-execution chain runs while the agent retries a previous step, and in the cloud, a scheduled run and manual run hit the same external resource.

The engine uses two layers working together to prevent corruption:

**Layer 1: Version counter on every run record.**

Every run record has a `version` field (integer, starts at 1). Every write increments it. Every write checks that the version hasn't changed since the read. If it has, the write is rejected with `STATE_SNAPSHOT_MISMATCH`.

The agent never sees or manages versions — the engine handles this internally:

```
1. Engine receives execute_step(run_id, command, params)
2. Engine reads run record → gets current version (e.g., 3)
3. Engine checks state guard and preconditions
4. Engine executes the step
5. Engine writes back with version check:
   "update only if version is still 3"
   
   Version still 3 → write succeeds, version becomes 4
   Version now 4   → STATE_SNAPSHOT_MISMATCH error
```

For the JSON file store (local), this requires a file lock around the read-check-write cycle to prevent two processes from reading simultaneously:

```typescript
async function updateRun(
  runId: string,
  expectedVersion: number,
  updates: Record<string, any>
): Promise<RunRecord> {
  const release = await acquireLock(`${runPath(runId)}.lock`, { timeout: 5000 })
  try {
    const record = await readRunFile(runId)
    
    if (record.version !== expectedVersion) {
      throw new WorkflowError({
        code: 'STATE_SNAPSHOT_MISMATCH',
        agent_action: 'report_to_user',
        message: `Run was modified by another operation. `
               + `Expected version ${expectedVersion}, `
               + `current version ${record.version}.`,
        details: {
          expected_version: expectedVersion,
          current_version: record.version,
          current_state: record.state
        }
      })
    }
    
    const updated = {
      ...record,
      ...updates,
      version: record.version + 1,
      updated_at: new Date().toISOString()
    }
    await writeRunFile(runId, updated)
    return updated
  } finally {
    await release()
  }
}
```

For Postgres (cloud), the version check is a WHERE clause — no file locks needed:

```sql
UPDATE runs
SET state = $2, data = $3, version = version + 1, updated_at = NOW()
WHERE run_id = $1 AND version = $4
RETURNING *;
```

If `WHERE version = $4` matches zero rows, the engine detects this and returns `STATE_SNAPSHOT_MISMATCH`.

**Layer 2: Intermediate pending states.**

Every step that involves a slow operation (network call, processing pipeline, waiting for agent response) transitions to a `_pending` state immediately before doing the work, then transitions to the final state when done:

```
1. Engine reads run: version 3, state: "target_validated"
2. Engine writes immediately: version 4, state: "document_fetching"
3. Engine fetches document (takes 30 seconds)
4. Engine writes on completion: version 5, state: "document_ready"
```

If another agent tries to call `fetch_document` during the 30-second fetch, it reads version 4, state `document_fetching`. The state guard blocks it — `fetch_document` isn't allowed from `document_fetching`. The agent gets `STATE_BLOCKED` with a clear message: "Document fetch is already in progress."

This prevents the obvious case (two calls to the same step) through the state guard, before the version check is even needed. The version check catches the subtle case (two different operations that both read the same version before either writes).

**How each concurrency scenario is handled:**

Agent retry (same step, same agent): The first call transitions to `_pending` immediately. The retry reads the pending state and gets `STATE_BLOCKED`. If both calls somehow slip past the state guard (extremely unlikely race window), the version check catches the second write.

Two agents on same run: First agent to call a step transitions to `_pending`. Second agent's call is blocked by the state guard seeing the pending state. If they call different steps simultaneously, the version check ensures only one write succeeds.

Auto-execution chain + external call: The auto chain holds the run record in memory for the entire chain. Each auto step updates the in-memory record. The version is written to the store at the start (pending state) and at the end (final state). An external call during the chain reads the pending state and gets blocked.

Long-running steps: The immediate `_pending` transition is critical. Without it, a 30-second fetch leaves the run in `target_validated` for 30 seconds, during which any concurrent call could pass the state guard. With the pending state, the window of vulnerability is reduced to the milliseconds between the state guard check and the pending state write.

**The conflict error response:**

```json
{
  "status": "error",
  "errors": [{
    "code": "STATE_SNAPSHOT_MISMATCH",
    "category": "STATE",
    "retryable": true,
    "agent_action": "report_to_user",
    "agent_message": "This workflow run was modified by another
                      operation while this step was executing.
                      This usually means another agent or browser
                      tab is driving the same run.",
    "details": {
      "expected_version": 3,
      "current_version": 4,
      "current_state": "document_ready",
      "step_attempted": "fetch_document"
    }
  }]
}
```

The `retryable` flag is `true` (the agent could retry and it might work if the run moved forward), but `agent_action` is `report_to_user` because concurrency conflicts indicate something unexpected — the user should know.

**Pending state naming convention:**

Every step that does slow work has a corresponding pending state. The naming convention is `{step_action}_pending` or `{step_name}_in_progress`:

```yaml
steps:
  validate_target:
    pending_state: target_validation_pending
    produces_state: target_validated

  fetch_document:
    pending_state: document_fetching
    produces_state: document_ready

  verify_identity:
    pending_state: identity_verification_pending
    produces_state: identity_resolved

  persist_update:
    pending_state: persistence_pending
    produces_state: persisted
```

Auto-execution steps that are fast (in-memory operations like state checks or schema lookups) don't need pending states — the version check alone is sufficient. The pending state is only needed when the operation takes long enough that a concurrent call could arrive during execution.

**Store interface requirement:**

The store interface must support atomic read-check-write from Phase 1:

```typescript
interface RunStore {
  createRun(params: CreateRunParams): Promise<RunRecord>
  getRun(runId: string): Promise<RunRecord>
  updateRun(runId: string, expectedVersion: number,
            updates: Record<string, any>): Promise<RunRecord>
  // updateRun throws STATE_SNAPSHOT_MISMATCH if version doesn't match
}
```

Both `JsonFileStore` and `PostgresStore` implement this interface. The version check is in the store implementation, not in the engine — the engine just calls `updateRun` with the expected version and handles the error if it's thrown.

**Concurrency model summary:**

| Store | Read isolation | Write conflict detection |
|-------|---------------|------------------------|
| JSON files (local) | File lock prevents concurrent reads during write | Version mismatch → `STATE_SNAPSHOT_MISMATCH` |
| Postgres (cloud) | Row-level `WHERE version = N` | Zero rows updated → `STATE_SNAPSHOT_MISMATCH` |

| Scenario | Prevention | Detection |
|----------|-----------|-----------|
| Agent retry (same step) | Pending state blocks duplicate via state guard | Version check catches if both slip through |
| Two agents on same run | Pending state blocks second agent | Version check catches concurrent different steps |
| Auto chain + external call | Pending state blocks external call | Version check as backup |
| Long-running step | Immediate pending transition narrows vulnerability window | Version check as backup |

### Run lifecycle, retention, and cleanup

A run goes through three phases: active (in progress, being modified), terminal (reached an end state, read-only), and archived (moved to cold storage, content may be evicted).

**Active phase:**

The run is in progress. Steps are executing, the agent is driving it, human gates might be pending. The run record is read and written frequently. Evidence snapshots are accumulating.

Active states include everything non-terminal: `run_created`, `target_validation_pending`, `target_validated`, `document_fetching`, `document_ready`, `identity_verification_pending`, `identity_resolved`, `extraction_pending`, `candidates_stored`, `validation_pending`, `validated`, `confirm_required` (waiting for human), `persistence_pending`, and any custom states defined by the workflow.

The key property: the run is expected to make progress. Either the engine is executing a step, or the agent is working, or a human is being asked to confirm.

**Terminal phase:**

The run has reached an end state. No more steps will execute. The run record is read-only — nothing modifies it (except `resume_run` for resumable states).

Four terminal states:

`completed` — the workflow finished successfully. All steps executed, all writes confirmed. The happy path. Not resumable — start a new run to re-process.

`cancelled` — a human chose to cancel at a confirmation gate, or the developer called `cancel_run`. No destructive action taken after cancellation (writes before cancellation are recorded in the evidence chain). Not resumable.

`failed` — a step failed permanently (all retries exhausted, non-retryable error) and the workflow can't continue. The error is recorded. Resumable via `resume_run` — the developer fixes the problem (corrects a URL, refreshes credentials) and resumes from the failed step. Previous successful steps and their evidence are preserved.

`abandoned` — the run timed out. The agent stopped responding, the user closed the browser, or a step's `on_timeout` policy was `abandon`. Resumable via `resume_run` with a warning: "Run resumed after {duration} of inactivity. External data may have changed."

The distinction between `failed` and `abandoned` matters for diagnostics: a high failure rate suggests a bug in the workflow or service. A high abandonment rate suggests the workflow is too long or timeouts are too aggressive.

**Archived phase:**

The run record is moved from hot storage to cold storage. Still accessible for audit queries, replay, and export. Cannot resume. Large content (document snapshots) may be evicted to save storage — the hash and metadata remain, but the full text is removed.

**Lifecycle transitions:**

```
                    ┌──────────────────────────┐
                    │         ACTIVE            │
                    │                           │
   create_run ───►  │  run_created              │
                    │  *_pending                │
                    │  *_validated / *_ready    │
                    │  confirm_required         │
                    │  extraction_pending       │
                    │  ...custom states...      │
                    │                           │
                    └───┬──────┬──────┬──────┬──┘
                        │      │      │      │
           success──────┘      │      │      └────timeout
           cancel──────────────┘      └───────────error
                        │          │        │        │
                    ┌───▼──────────▼────────▼────────▼──┐
                    │          TERMINAL                   │
                    │                                     │
                    │  completed  (not resumable)         │
                    │  cancelled  (not resumable)         │
                    │  failed     (resumable)             │
                    │  abandoned  (resumable with warning)│
                    │                                     │
                    └──────────────┬──────────────────────┘
                                  │
                       retention policy (default: 30d)
                                  │
                    ┌─────────────▼────────────────────┐
                    │          ARCHIVED                 │
                    │                                   │
                    │  Read-only. Content may be        │
                    │  evicted. Hash + metadata kept.   │
                    │  Can inspect, replay, export.     │
                    │  Cannot resume.                   │
                    │                                   │
                    └──────────────┬────────────────────┘
                                  │
                       deletion policy (default: 365d)
                                  │
                    ┌─────────────▼────────────────────┐
                    │          DELETED                  │
                    │  Permanently removed.             │
                    └──────────────────────────────────┘
```

**Content deduplication for repeated documents:**

If 50 scheduled runs process the same document monthly, storing 50 copies of the same 34K text wastes space. The engine deduplicates by hash — if a document's SHA-256 matches already-stored content, the run record stores a reference instead of a copy:

```
Run record for run-001:
  document_snapshot:
    hash: "sha256:abc789"
    content_ref: "content/sha256-abc789"    # pointer to shared storage
    captured_at: "2025-03-30T14:22:00Z"

Run record for run-002 (same document, one month later):
  document_snapshot:
    hash: "sha256:abc789"
    content_ref: "content/sha256-abc789"    # same pointer
    captured_at: "2025-04-30T14:22:00Z"
```

The document text is stored once. Both runs reference it. When all runs referencing a hash are deleted, the shared content is garbage collected.

For local (JSON file store): a `content/` directory alongside `runs/`, keyed by hash. For cloud (Postgres): a separate content table or blob store with hash-based keys.

**Content eviction for archived runs:**

When a run is archived, large content can be evicted. The run record keeps the hash and metadata (audit trail intact) but the actual text is removed:

```
Before eviction:
  document_snapshot:
    hash: "sha256:abc789"
    content_ref: "content/sha256-abc789"
    char_count: 34372
    format: "markdown"
    content_available: true

After eviction:
  document_snapshot:
    hash: "sha256:abc789"
    content_ref: null
    char_count: 34372
    format: "markdown"
    content_available: false
    evicted_at: "2025-06-30T00:00:00Z"
```

The audit trail still shows: this run used a document with hash `sha256:abc789`, 34,372 characters, markdown format. The developer can't retrieve the text, but they can re-fetch the document from the original URL (if it still exists) or find another run with the same hash that hasn't been evicted.

**Retention configuration in workflow YAML:**

```yaml
workflow:
  retention:
    terminal_to_archived: 30d           # archive after 30 days
    archived_to_deleted: 365d           # delete after 1 year
    evict_content_on_archive: true      # remove large content when archiving
    evict_threshold: 10000              # only evict content > 10K chars
    never_evict: [validation_report]    # always keep these fields
```

All values have sensible defaults. A minimal workflow YAML doesn't need a retention section at all — defaults apply automatically.

**Cleanup triggers:**

Local (JSON file store): lazy cleanup on `create_run` — check for stale active runs (no update in 24 hours, transition to `abandoned`). Also available as CLI: `realm cleanup --older-than 30d` and `realm cleanup --dry-run` to preview.

Cloud (Postgres): scheduled nightly job. Moves terminal runs past `terminal_to_archived` to archived status. Deletes archived runs past `archived_to_deleted`. Evicts content per workflow retention config. Reports cleanup activity in the dashboard.

Both: `realm cleanup` CLI for manual cleanup. The engine never deletes a run during normal operation — cleanup is always a separate process (lazy, scheduled, or manual).

**The run record with lifecycle fields:**

```typescript
interface RunRecord {
  // Identity
  run_id: string
  workflow_id: string
  version: number                    // concurrency control

  // Lifecycle
  lifecycle: 'active' | 'terminal' | 'archived'
  state: string                      // current state within lifecycle
  terminal_reason?: 'completed' | 'cancelled' | 'failed' | 'abandoned'
  resumable: boolean                 // can resume_run be called?

  // Timestamps
  created_at: string
  updated_at: string
  completed_at?: string              // when it reached terminal
  archived_at?: string               // when it was archived
  
  // Content management
  content_evicted: boolean
  evicted_at?: string
  
  // ... params, evidence, step history, etc.
}
```

**Storage cost estimate:**

| Runs per month | Avg run size | Monthly storage | With deduplication |
|---------------|-------------|----------------|-------------------|
| 100 | ~60K | 6 MB | ~3 MB |
| 1,000 | ~60K | 60 MB | ~20 MB |
| 10,000 | ~60K | 600 MB | ~150 MB |

Deduplication savings depend on how many runs process the same documents. For scheduled workflows (same document processed monthly), savings are significant. For ad-hoc workflows (different document every time), savings are minimal. Content eviction on archival caps long-term growth regardless.

### Human gate mechanics

When a step's trust level requires human involvement (`human_confirmed` or `human_reviewed`), the engine can't talk to the user directly — it can only talk to the agent. The agent is the intermediary. The engine tells the agent "show this to the user and wait," and the agent relays the user's decision back.

**The complete flow:**

```
1. Agent calls execute_step(run_id, "validate_candidates", params)

2. Engine executes validation. 11 fields accepted, 3 rejected.
   Step's trust_level is human_confirmed.

3. Engine transitions to confirmation state:
   - State: "awaiting_human_confirmation"
   - Pending state prevents any other step from executing
   - Timeout starts (e.g., 24 hours)
   - Gate ID generated: "gate_a1b2c3"

4. Engine returns ResponseEnvelope:
   {
     status: "confirm_required",
     data: {
       gate_id: "gate_a1b2c3",
       gate_type: "human_confirmed",
       preview: {
         accepted_fields: [
           { field_id: "leasing_fee", value: "10%" },
           { field_id: "management_fee", value: "$150/mo" },
           ...
         ],
         rejected_fields: [
           { field_id: "renewal_fee", reason: "quote not found" },
           ...
         ],
         summary: "11 fields accepted, 3 rejected, 8 not found"
       },
       choices: ["confirm", "cancel"],
       message: "Review the extracted fields. Confirm to write
                 the 11 accepted fields, or cancel to discard."
     },
     next_action: {
       instruction: {
         tool: "submit_human_response",
         params: { run_id: "abc-123", gate_id: "gate_a1b2c3" }
       },
       human_readable: "Show the preview to the user. Wait for them
                        to confirm or cancel. Then call
                        submit_human_response with their choice.",
       context_hint: "This is a human confirmation gate.
                      Do NOT auto-confirm. The user must decide."
     }
   }

5. Agent shows the preview to the user and waits.

6. User reviews and says "yes, go ahead"

7. Agent calls submit_human_response(
     run_id: "abc-123",
     gate_id: "gate_a1b2c3",
     choice: "confirm",
     user_message: "yes, go ahead"
   )

8. Engine verifies:
   - Run is in "awaiting_human_confirmation" state
   - gate_id matches the pending gate
   - choice is in the allowed set ["confirm", "cancel"]
   All pass → engine proceeds with the confirmed action

9. Engine returns ResponseEnvelope:
   { status: "ok", next_action: { ... next step ... } }
```

**Why a separate `submit_human_response` MCP tool (not `execute_step`):**

The gate is semantically distinct from a normal step execution. Using a separate MCP tool provides three benefits:

First, the evidence chain records it as "human response" not "step execution." This matters for audit: "who decided to write these fields?" → "the user confirmed at gate_a1b2c3 at 14:25:30."

Second, the `gate_id` binds the response to the specific gate instance. The engine issued gate `gate_a1b2c3` with a specific preview. The response must reference that exact gate. This prevents a bug where the agent submits a confirmation for a different gate it hallucinated from conversation context.

Third, it's a clean separation in the MCP tool list. The agent sees `execute_step` (drive the workflow) and `submit_human_response` (relay user decisions). Two tools for two actions, less likely to confuse.

**The `submit_human_response` MCP tool:**

```
submit_human_response(
  run_id: string,        # which run
  gate_id: string,       # must match the pending gate
  choice: string,        # must be one of the gate's declared choices
  user_message?: string, # optional — user's exact words (for audit)
  review_answer?: string,# for human_reviewed gates — answer to challenge
  choice_data?: object   # for complex choices (e.g., partial approval)
)

Returns: ResponseEnvelope
  On confirm: { status: "ok", next_action: { ... next step ... } }
  On cancel:  { status: "ok", data: { state: "cancelled" } }
  On error:   { status: "error", code: "STATE_GATE_MISMATCH" | ... }

Error cases:
  - gate_id doesn't match pending gate → STATE_GATE_MISMATCH
  - choice not in allowed set → VALIDATION_INPUT_SCHEMA
  - run not in awaiting state → STATE_BLOCKED
  - review_answer wrong (human_reviewed) → VALIDATION_REVIEW_FAILED
```

**User asking questions while confirmation is pending:**

The user sees the preview and asks "why was renewal_fee rejected?" or "what does the leasing_fee value mean?" The agent should answer without affecting the run state.

This works naturally: the run is in `awaiting_human_confirmation` state. The only command the engine accepts is `submit_human_response` with the correct `gate_id`. If the agent tries `execute_step` or any other tool, the engine returns `STATE_BLOCKED`. The agent can have a full conversation with the user — answering questions, explaining values — and the run state doesn't change. When the user finally decides, the agent calls `submit_human_response`.

If the agent loses context (long conversation, tab switch), it can call `get_run_state` to rediscover the pending gate:

```
Agent calls get_run_state(run_id: "abc-123")

Returns:
{
  state: "awaiting_human_confirmation",
  pending_gate: {
    gate_id: "gate_a1b2c3",
    gate_type: "human_confirmed",
    preview: { ... same preview data ... },
    choices: ["confirm", "cancel"],
    message: "Review the extracted fields...",
    created_at: "2025-03-30T14:22:00Z",
    timeout_at: "2025-03-31T14:22:00Z"
  }
}
```

The agent re-presents the confirmation question without the engine needing to re-issue it.

**How does the engine know the user actually decided (not the agent)?**

The engine can't fully verify this — it talks to the agent, not the user. Three mitigations provide graduated assurance:

First, the protocol tells the agent not to auto-confirm. This is guidance, not enforcement — but it's the same mechanism that makes agents follow all other workflow instructions, and it works in practice.

Second, the `user_message` field is recorded in the evidence chain. If the agent includes the user's exact words ("yes, go ahead"), the audit trail shows what the user said. If the field is empty or generic, a developer reviewing the run can notice.

Third, `human_reviewed` gates include a review challenge — a question the user must answer to prove they read the preview:

```json
{
  "gate_type": "human_reviewed",
  "review_challenge": {
    "question": "What is the total number of accepted fields?",
    "expected_answer": "11"
  },
  "preview": { ... }
}
```

The agent must include the answer in `submit_human_response`. The engine checks it matches. This adds friction to auto-confirmation — the agent has to read the preview, find the answer, and include it. Detectable in the evidence chain if `response_time_seconds` is suspiciously low.

For most workflows, `human_confirmed` is sufficient. `human_reviewed` is for high-stakes operations where the audit trail needs stronger proof of human involvement.

**Gate types beyond confirm/cancel:**

Gates support any set of named choices, not just confirm/cancel:

```yaml
steps:
  select_pricing:
    trust_level: human_confirmed
    gate_config:
      choices: [standard, premium, custom]
      message: "Which pricing tier should we use?"
      choice_descriptions:
        standard: "Standard pricing (10% of rent)"
        premium: "Premium pricing (8% of rent, higher minimum)"
        custom: "Custom pricing (enter manually)"

  review_extraction:
    trust_level: human_reviewed
    gate_config:
      choices: [approve, reject, approve_partial]
      review_challenge:
        question: "How many fields were accepted?"
        answer_from: data.accepted_count
```

For `approve_partial`, the response includes which items were approved:

```
submit_human_response(
  run_id: "abc-123",
  gate_id: "gate_a1b2c3",
  choice: "approve_partial",
  choice_data: {
    approved_fields: ["leasing_fee", "management_fee", "late_fee"],
    rejected_fields: ["renewal_fee"]
  },
  user_message: "Approve the first three but skip renewal_fee"
)
```

The engine continues with only the approved fields. The evidence chain records exactly which the user approved and which they excluded.

**Gate evidence in the run record:**

```json
{
  "step": "confirm_update",
  "gate": {
    "gate_id": "gate_a1b2c3",
    "gate_type": "human_confirmed",
    "issued_at": "2025-03-30T14:22:00Z",
    "preview_summary": "11 accepted, 3 rejected, 8 not found",
    "choices_offered": ["confirm", "cancel"],
    "response": {
      "choice": "confirm",
      "user_message": "Yes, write the 11 fields",
      "responded_at": "2025-03-30T14:25:30Z",
      "response_time_seconds": 210
    }
  }
}
```

The developer sees: gate issued at 14:22, user responded at 14:25 (3.5 minutes — a human response time, not instant), user said "Yes, write the 11 fields," choice was "confirm."

For the cloud version, suspiciously fast response times (e.g., 200ms) can be flagged in analytics: "This confirmation was submitted 200ms after the gate was issued. This may indicate auto-confirmation by the agent."

**Updated MCP tool set:**

```
list_workflows()                                → available workflows
get_workflow_protocol(workflow_id)               → full protocol with rules
start_run(workflow_id, params)                   → creates run, returns first next_action
execute_step(run_id, command, params)            → executes a step
submit_human_response(run_id, gate_id, choice, ...)  → submits human decision
get_run_state(run_id)                            → current state, pending gate if any
```

Six tools total. Clean separation: `execute_step` for workflow progression, `submit_human_response` for human decisions, `get_run_state` for recovering context.

### Conditional branching in the flow graph

The current design assumes workflows are linear: step 1 → step 2 → step 3. But real workflows have branches. The clozr workflow already has implicit branching: if identity verification fails, the workflow takes a different path (human gate) than if it succeeds (auto-continue). If the user cancels at confirmation, the workflow takes a cancellation path.

The workflow definition should support explicit branching:

```yaml
steps:
  verify_identity:
    produces_state: identity_resolved
    transitions:
      on_success: build_extraction_input
      on_confirm_required: wait_for_human
      on_error: report_and_stop

  confirm_update:
    transitions:
      on_confirm: persist_update
      on_cancel: cancel_run
      on_timeout: abandon_run

  validate_candidates:
    transitions:
      on_success:
        condition: "data.accepted_count > 0"
        if_true: show_validation_report
        if_false: report_no_candidates
```

This makes the flow graph explicit in the workflow definition instead of being buried in step implementations. Benefits:

- The engine can validate the graph at registration time — check for unreachable states, missing transitions, infinite loops, and dead-end states with no outbound transitions.
- Diagnostics show which branch was taken for each run, making it easy to see at a glance why a run ended up where it did.
- The `condition` field supports simple expressions against the step's output data. Complex conditions are handled by the step implementation returning different status values.

For the `next_action` generation, the engine uses the transition that fired to determine what instruction to give the agent. If `verify_identity` returns `confirm_required`, the engine looks up the `on_confirm_required` transition, sees it goes to `wait_for_human`, and generates the appropriate `next_action` telling the agent to show the preview and wait.

### Parallel step execution

Some workflow steps could run simultaneously because they don't depend on each other. In a document extraction workflow, fetching the document and validating the target record are independent — neither needs the other's output. In a multi-document workflow, processing several documents in parallel speeds things up significantly.

The workflow definition supports parallel groups:

```yaml
flow:
  - step: create_run
  - parallel:
      - step: validate_target
      - step: fetch_document
    join: all_must_succeed         # wait for both, fail if either fails
  - step: verify_identity          # runs after both parallel steps complete
  - step: build_extraction_input
```

Join strategies:
- `all_must_succeed` — wait for all parallel steps to complete. If any fails, the parallel group fails. Most common.
- `first_success` — continue as soon as one step succeeds. Cancel the others. Useful for redundant fetching (try multiple sources, use whichever responds first).
- `best_effort` — wait for all to complete, continue even if some failed. Collect results from the successful ones.

The engine starts all parallel steps, waits per the join strategy, and then continues to the next sequential step. Evidence is captured for all parallel branches independently. The run state tracks multiple in-progress steps.

Parallel steps in auto-execution mode are fully engine-internal — no agent involvement needed. In agent mode, parallel execution is limited to auto steps only (requiring the agent to handle multiple concurrent instructions adds too much complexity for too little benefit).

For the clozr workflow, running `validate_target` and `fetch_document` in parallel saves 1-3 seconds per run. Not huge for a single run, but significant when running hundreds of scheduled workflows in the cloud.

### Workflow composition (sub-workflows)

Real use cases often involve nested workflows. An "onboard new client" workflow might include "extract playbook from document" as one step, followed by "set up CRM record" and "send welcome email" — each of which could be its own workflow with its own steps, evidence chain, and human gates.

The engine supports calling one workflow from within another:

```yaml
steps:
  extract_playbook:
    type: sub_workflow
    workflow_id: playbook-extraction
    params_from:
      document_url: run_params.document_url
      company_name: run_params.company_name
    on_complete: setup_crm
    on_failure: report_and_stop

  setup_crm:
    type: sub_workflow
    workflow_id: crm-record-creation
    params_from:
      company_name: run_params.company_name
      extracted_fields: steps.extract_playbook.outputs.accepted_fields
    on_complete: send_welcome

  send_welcome:
    type: step
    execution: auto
    uses_service: email
    # ... regular step definition
```

The sub-workflow gets its own run record — its own evidence chain, its own state machine, its own step history. But the parent workflow tracks it as a single step. The parent waits for the sub-workflow to complete before continuing. If the sub-workflow hits a human gate, the parent workflow pauses too.

This enables building complex multi-stage processes from smaller, tested workflow components. Each component is independently debuggable (inspect the sub-workflow's run record), independently versioned (update the playbook extraction workflow without touching the onboarding workflow), and independently reusable (the same extraction workflow used in onboarding, in monthly updates, and in ad-hoc requests).

The parent run's evidence chain includes a reference to the sub-workflow run (run_id, final status, summary of outputs) but not the full sub-workflow evidence — that lives in the sub-workflow's own run record. This keeps run records from growing unbounded in nested scenarios.

### Implementation priority for engine improvements

| Improvement | Impact | Complexity | When to build |
|------------|--------|-----------|---------------|
| Structured `next_action` + auto-execution | Major speed improvement, fewer agent errors, fewer round-trips | Medium | Phase 1 — design it in from the start |
| Input schema validation per step | Catches malformed agent input early, serves as documentation | Low | Phase 1 — straightforward JSON Schema check |
| Step-level retry | Runs don't die from transient network failures | Low-Medium | Phase 1-2 |
| Step timeouts and stale detection | Runs don't hang forever waiting for agent | Low | Phase 1-2 |
| Run resume from failed step | Don't re-run successful steps after a fixable failure | Medium | Phase 2 |
| Conditional branching | Handles real workflow patterns (success/failure/cancel paths) | Medium | Phase 2 |
| `input_map` with expression language | Steps receive computed inputs from prior step results | Medium | Phase 2-3 |
| `on_error: fallback` with `fallback_step` | Error recovery routes to alternative steps | Low | Phase 2-3 |
| `type: for_each` with accumulators | Iterate over collections (batch processing, multi-document) | Medium-High | Phase 3-4 |
| `type: parallel` (branches) | Fan-out into concurrent branches, wait for all | Medium-High | Phase 3+ |
| `type: while` with safety limits | Repeat until condition met (polling, convergence) | Medium | Phase 4-5 |
| `type: call_workflow` (sub-workflows) | Build complex flows from tested components | High | Phase 4+ |
| `break_when` for early loop exit | Stop iterating when a condition is met | Low | Phase 4-5 |

The first four should be designed into the engine from day one — they are fundamental reliability features that prevent common failure modes. Branching and `input_map` should follow soon after (Phase 2-3) since even simple workflows need computed inputs and success/failure paths. Loops (`for_each`) are Phase 3-4 because batch processing is the first use case that demands iteration. `while` and `call_workflow` can wait until the core is proven.

### Expression language specification

The expression language is used across the workflow definition: in `preconditions`, `when`, `input_map`, `over`, `condition`, `break_when`, and `accumulate`. It is the same evaluator everywhere — learn it once, use it in any context.

**Supported operations:**

```
Property access:        step_name.result.field_name
                        run_params.company_name
                        workflow.schema.fields

Array indexing:         results[0]
                        results[-1]              (last item)

Comparisons:            a == b, a != b, a > b, a < b, a >= b, a <= b

Boolean logic:          a && b, a || b, !a

Arithmetic:             a + b, a - b, a * b, a / b

Ternary:                condition ? value_if_true : value_if_false

String concatenation:   "prefix_" + field_name

Array concatenation:    list + [new_item]

Pipe filters:           value | count
                        value | where(status == 'tracked')
                        value | first
                        value | last
                        value | flatten
                        value | join(', ')
                        value | uppercase
                        value | lowercase
                        value | sort(field_name)
                        value | slice(start, end)

Literals:               "string", 42, 3.14, true, false, null
                        [1, 2, 3]                (array)
                        {key: "value"}           (object)
```

**Not supported (by design):**

Variable assignment, function definitions, closures, imports, `eval`, `new`, `require`, `fetch`, filesystem access, or any side effects. The evaluator is read-only — it computes a value from the available context and returns it. It cannot modify state, call APIs, or execute code.

**Available context:**

The expression evaluator has access to: `run_params` (workflow parameters from `start_run`), `workflow.schema` (the registered schema), step results by name (e.g., `fetch_document.result`), and loop variables (`as` binding in `for_each`). In `accumulate` expressions, the current accumulator values are also in scope.

**Security model:**

The expression evaluator is implemented as a simple recursive-descent parser that walks an AST. It does NOT use `eval()`, `new Function()`, or any form of dynamic code execution. The AST nodes are a closed set — property access, comparison, arithmetic, ternary, pipe, literal. There is no way to inject arbitrary JavaScript through an expression. This makes expressions safe to evaluate on the cloud with zero sandboxing overhead.

### Extensions: adapters, processors, and step handlers

The engine is extended through three minimal interfaces. Each serves a different purpose and has a different contract. They are collectively called "extensions" — the term is generic, unpretentious, and immediately understood.

The key principle: the engine handles everything around the extension automatically (evidence capture, input validation, timeout management, retry logic). The developer's code just does the work — takes input, returns output.

**Service Adapter — handles communication with external services**

A service adapter connects the engine to a specific external service (Google Docs, Bubble, Salesforce, Airtable). It handles authentication quirks, URL patterns, response format mapping, rate limiting, and pagination for that service.

```typescript
interface ServiceAdapter {
  id: string
  fetch(operation: string, params: Record<string, any>): Promise<ServiceResponse>
}

// ServiceResponse is a simple structure:
interface ServiceResponse {
  status: number              // HTTP status or equivalent
  data: any                   // parsed response body
  raw?: string                // raw response for audit
  metadata?: Record<string, any>  // headers, timing, etc.
}
```

One method plus an ID. The engine calls `fetch` with an operation name (from the workflow YAML) and params. The adapter makes the HTTP call and returns the result. The engine wraps every call with evidence capture (request/response snapshot), timeout enforcement, and retry logic.

Example — a minimal Airtable adapter:

```typescript
const airtableAdapter: ServiceAdapter = {
  id: 'airtable',
  async fetch(operation, params) {
    if (operation === 'read_record') {
      const response = await fetch(
        `https://api.airtable.com/v0/${params.base_id}/${params.table}/${params.record_id}`,
        { headers: { Authorization: `Bearer ${params.api_key}` } }
      )
      return { status: response.status, data: await response.json() }
    }
    // ... other operations
  }
}
```

**Processor — transforms content in a pipeline**

A processor takes content in (text, metadata) and returns content out (transformed text, updated metadata). Stateless — no side effects, no external calls (unless it's a webhook processor calling the developer's server).

```typescript
interface Processor {
  id: string
  process(content: ProcessorInput, config: Record<string, any>): Promise<ProcessorOutput>
}

interface ProcessorInput {
  text: string
  metadata: Record<string, any>
}

interface ProcessorOutput {
  text: string
  metadata: Record<string, any>
}
```

One method plus an ID. The engine runs processors in pipeline order, passing each processor's output as the next processor's input. The engine captures evidence for each processor (input size, output size, what changed, duration).

Example — a minimal SSN redaction processor:

```typescript
const redactSsn: Processor = {
  id: 'redact_ssn',
  async process(content, config) {
    const redacted = content.text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN REDACTED]')
    const count = (content.text.match(/\b\d{3}-\d{2}-\d{4}\b/g) || []).length
    return {
      text: redacted,
      metadata: { ...content.metadata, ssn_redactions: count }
    }
  }
}
```

**Step Handler — custom business logic for a workflow step**

A step handler implements custom logic that the built-in engine can't handle. The extraction validation in the clozr app (regex matching, fuzzy scoring, deduplication) is an example — the engine handles state guards, evidence capture, and context assembly, but the actual business logic is custom.

```typescript
interface StepHandler {
  id: string
  execute(inputs: StepInputs, context: StepContext): Promise<StepOutputs>
}

interface StepInputs {
  params: Record<string, any>     // from the agent's execute_step call
  run_data: Record<string, any>   // relevant data from the run record
}

interface StepContext {
  resources: Record<string, any>  // assembled by the engine (documents, schemas)
  config: Record<string, any>     // from the workflow YAML step config
}

interface StepOutputs {
  data: Record<string, any>       // step-specific output (goes into response envelope)
  state_update?: Record<string, any>  // fields to update in the run record
  status?: string                 // override status (default: "ok")
}
```

One method plus an ID. The engine calls `execute` with the validated inputs and assembled context. The step handler does its work and returns the result. The engine wraps it with evidence capture, state transition, and response envelope construction.

Example — a minimal field validation step handler:

```typescript
const validateFields: StepHandler = {
  id: 'validate_extracted_fields',
  async execute(inputs, context) {
    const candidates = inputs.params.candidates
    const documentText = context.resources.document_text
    
    const accepted = []
    const rejected = []
    for (const candidate of candidates) {
      if (documentText.includes(candidate.verbatim_quote)) {
        accepted.push(candidate)
      } else {
        rejected.push({ ...candidate, reason: 'quote not found in document' })
      }
    }
    
    return {
      data: { accepted, rejected, accepted_count: accepted.length },
      state_update: { accepted_candidates: accepted, rejected_candidates: rejected }
    }
  }
}
```

**Registering extensions with the engine:**

```typescript
import { engine } from '@sensigo/realm'

// Register a service adapter
engine.registerAdapter(airtableAdapter)

// Register a processor
engine.registerProcessor(redactSsn)

// Register a step handler
engine.registerStepHandler(validateFields)
```

Then reference them in the workflow YAML:

```yaml
services:
  database:
    adapter: airtable              # references the registered adapter

processing_pipeline:
  - step: redact_ssn               # references the registered processor

steps:
  validate_candidates:
    handler: validate_extracted_fields   # references the registered step handler
    execution: auto                      # engine calls the handler internally
```

**What the engine handles automatically for every extension:**

- Evidence capture: every adapter call, processor execution, and step handler invocation is recorded with inputs, outputs, timing, and errors
- Input validation: if the step has an input schema, the engine validates params before calling the handler
- Timeout enforcement: the engine kills the extension call if it exceeds the step's declared timeout
- Retry logic: for adapters, the engine retries on transient errors per the step's retry policy
- Error wrapping: if the extension throws, the engine catches it and returns a proper error envelope

The developer never thinks about any of these — they write a function that takes input and returns output.

### Step templates: reusable step groups

Extensions handle code-level reuse (one adapter, one processor, one handler). Workflow composition handles full-workflow reuse (a complete workflow as a sub-step). Step templates fill the gap in between: a reusable group of step definitions that can be included in any workflow without the overhead of a separate run record.

A step template is a YAML file that defines a sequence of steps with parameterized configuration. It's resolved at registration time — the engine reads the template, substitutes parameters, merges steps, and stores the resolved workflow. At runtime, there's no concept of "template." The engine sees a flat list of steps.

**Defining a template:**

```yaml
# templates/document-extraction.yaml
template:
  id: document-extraction
  description: "Fetch a document, verify identity, extract fields, validate quotes"

  # Parameters the including workflow must provide
  parameters:
    document_url: { type: string, required: true }
    company_name: { type: string, required: true }
    schema_ref: { type: string, required: true }
    confidence_threshold: { type: number, default: 70 }
    match_mode: { type: string, default: "strict" }

  # Steps defined in the template
  steps:
    fetch_document:
      execution: auto
      uses_service: document_source
      timeout: 60s

    verify_identity:
      execution: auto
      preconditions:
        - check: run.document_hash exists
      config:
        confidence_threshold: ${{ parameters.confidence_threshold }}
      transitions:
        on_success: extract_fields
        on_confirm_required: wait_for_human

    extract_fields:
      execution: agent
      preconditions:
        - check: run.identity_result.status == "confirmed"
      config:
        schema_ref: ${{ parameters.schema_ref }}

    validate_quotes:
      execution: auto
      handler: validate_extracted_fields
      config:
        match_mode: ${{ parameters.match_mode }}
```

**Including a template in a workflow:**

```yaml
# workflows/playbook-extraction.yaml
id: playbook-extraction

includes:
  - template: document-extraction
    with:
      document_url: run_params.document_url
      company_name: run_params.company_name
      schema_ref: "./schemas/playbook-fields.json"
      confidence_threshold: 70
      match_mode: strict

# Additional steps specific to this workflow
steps:
  confirm_update:
    execution: agent
    preconditions:
      - check: run.validation_report.accepted_count > 0
    transitions:
      on_confirm: persist_update
      on_cancel: cancel_run

  persist_update:
    execution: auto
    uses_service: database
```

The template's steps (fetch_document, verify_identity, extract_fields, validate_quotes) and the workflow's own steps (confirm_update, persist_update) are merged into one flat step list. The `${{ parameters.X }}` syntax is resolved at registration time — simple string substitution, like GitHub Actions.

**Per-step overrides:**

When a workflow includes a template, it can override any aspect of any template step without rewriting the entire template:

```yaml
includes:
  - template: document-extraction
    with:
      document_url: run_params.document_url
      company_name: run_params.company_name
      schema_ref: "./schemas/playbook-fields.json"

    # Per-step overrides
    override_steps:
      verify_identity:
        # Add a precondition the template doesn't have
        preconditions_append:
          - check: run.document_char_count > 500
            explanation: "Document must have meaningful content"
        # Change timeout from template default
        timeout: 120s
        # Add on_timeout behavior
        on_timeout: warn_and_wait

      extract_fields:
        # Change execution mode for this workflow only
        execution: agent
        # Deep merge with template config
        config:
          extraction_method: two_pass_cue_scan
          min_candidates: 10
```

**Override merge rules:**

Scalar values (timeout, execution, description): override replaces template value entirely.

Config objects: deep merge. Override keys replace template keys. Template keys not in the override are preserved. New keys from the override are added.

```
Template config:              Override config:
  match_mode: strict            extraction_method: two_pass_cue_scan
  fuzzy_fallback: true          min_candidates: 10

Result (deep merge):
  match_mode: strict            ← preserved from template
  fuzzy_fallback: true          ← preserved from template
  extraction_method: two_pass   ← added from override
  min_candidates: 10            ← added from override
```

Array fields (preconditions, etc.): the developer explicitly chooses append or replace:

```yaml
# Append: template preconditions + new ones
preconditions_append:
  - check: run.document_char_count > 500
    explanation: "Document must have meaningful content"

# Replace: only these, template ones discarded
preconditions_replace:
  - check: run.custom_check.passed == true
    explanation: "Custom verification must pass first"
```

Transitions: `transitions_merge` does key-level merge (override keys replace, template keys preserved, new keys added). `transitions_replace` discards all template transitions.

```yaml
override_steps:
  verify_identity:
    transitions_merge:
      on_success: custom_pre_extraction_check    # override existing
      on_timeout: escalate_to_admin              # add new
      # on_confirm_required and on_error preserved from template
```

**Inserting new steps between template steps:**

A developer can add steps that the template doesn't know about by redirecting transitions:

```yaml
includes:
  - template: document-extraction
    with: { ... }
    override_steps:
      verify_identity:
        transitions_merge:
          on_success: custom_branding_check    # redirect to new step

steps:
  custom_branding_check:
    description: "Additional branding verification for this client"
    execution: auto
    handler: check_client_branding
    config:
      expected_brand: "PMI Georgia"
    transitions:
      on_success: extract_fields       # continue to template's next step
      on_error: report_and_stop
```

The new step bridges between template steps. The engine sees a flat flow graph — it doesn't know or care which steps came from the template and which were defined locally.

**Collision avoidance with prefixes:**

When a workflow includes multiple templates that might have steps with the same ID, prefixes prevent collisions:

```yaml
includes:
  - template: document-extraction
    prefix: doc_
    with: { ... }

  - template: api-sync
    prefix: sync_
    with: { ... }
```

All step IDs from the first template become `doc_fetch_document`, `doc_verify_identity`, etc. All step IDs from the second become `sync_fetch_record`, `sync_write_fields`, etc. The prefix is applied during template resolution, before the merge.

Without prefixes, the engine rejects workflows where two templates define a step with the same ID: "Step 'fetch_document' is defined in both template 'document-extraction' and template 'api-sync'. Rename one or use a step prefix."

**Templates can include other templates** (with a depth limit of 3 to prevent infinite recursion). A "full document pipeline" template might include a "document fetch and verify" template and a "field extraction and validation" template.

**Templates as plugins:** A domain schema pack (like `real-estate-leasing` at $19) includes both the schema JSON and a step template. Install the plugin, include the template, provide your service config and document URL — a working pipeline in minutes.

**Resolution order at registration time:**

```
1. Engine reads the workflow YAML
2. Engine finds the includes section
3. For each included template:
   a. Load the template file
   b. Substitute parameters (${{ parameters.X }} → actual values)
   c. Apply prefixes to step IDs (if configured)
   d. Apply override_steps:
      - Scalars: override replaces template
      - Config objects: deep merge
      - Arrays with _append: concatenate
      - Arrays with _replace: discard template, use override
      - Transitions with _merge: key-level merge
      - Transitions with _replace: discard template, use override
   e. Merge resolved template steps into workflow's step list
4. Check for step ID collisions
5. Validate the complete merged workflow
   (same checks as realm validate)
6. Store the fully resolved workflow definition
```

At runtime, the engine has a flat, fully resolved workflow. No template references, no override markers, no parameter placeholders. Zero runtime overhead.

**Override summary:**

| Override type | Syntax | Behavior |
|--------------|--------|----------|
| Scalar (timeout, execution) | Direct assignment | Replaces template value |
| Config object | Direct assignment | Deep merge |
| Preconditions | `preconditions_append` | Template kept, new ones added |
| Preconditions | `preconditions_replace` | Template discarded, only override's |
| Transitions | `transitions_merge` | Key-level merge |
| Transitions | `transitions_replace` | Template discarded, only override's |
| New steps | Define in workflow's `steps` | Merged alongside template steps |
| Step insertion | Override transition + define new step | New step bridges template steps |
| Collision avoidance | `prefix` on include | All template step IDs get prefix |

**Reuse mechanisms — complete picture:**

| Mechanism | What it reuses | Runtime overhead | Granularity | When to use |
|-----------|---------------|-----------------|-------------|-------------|
| Extensions | A single function (adapter, processor, handler) | None | One operation | Same operation across workflows |
| Step templates | A group of step definitions with shared config | None (resolved at registration) | Multiple steps | Same step sequence across workflows |
| Workflow composition | An entire workflow with its own lifecycle | Separate run record + evidence chain | Full workflow | Independently useful workflow needing own audit trail |

---

## Part 5: The MCP Server and Skill File

### How the agent connects

The agent doesn't know about the workflow engine directly. It connects via MCP — the standard protocol for AI agents to call external tools. The MCP server exposes a set of tools that wrap the engine.

### MCP tools exposed

```
list_workflows()
  → returns available workflows with descriptions

get_workflow_protocol(workflow_id)
  → returns the full protocol: rules, step descriptions,
    error handling instructions
  → this replaces the detailed workflow instructions
    that currently live in the skill file

start_run(workflow_id, params)
  → creates a new run, returns run_id and first next_action

execute_step(run_id, command, params)
  → executes one step, returns ResponseEnvelope with next_action

submit_human_response(run_id, gate_id, choice, user_message?, review_answer?, choice_data?)
  → submits a human decision at a confirmation gate
  → see Part 4 "Human gate mechanics" for full details

get_run_state(run_id)
  → returns current state, pending gate if any, step history, evidence chain
```

Six tools total. `execute_step` for workflow progression, `submit_human_response` for human decisions, `get_run_state` for recovering context after the agent loses track.

### The `get_workflow_protocol` response — what the agent receives

The protocol is the agent's complete briefing for a workflow. It answers five questions: what does this workflow do, what steps will I execute, which steps do I call vs which the engine handles, what params does each step expect, and what rules must I follow. The engine generates it from the workflow YAML — it's not hand-written.

**Response structure:**

```json
{
  "workflow_id": "playbook-extraction",
  "name": "Playbook Field Extraction",
  "description": "Extract fields from a property management playbook
                  document and write validated values to Bubble",
  "execution_mode": "hybrid",

  "params_schema": {
    "required": ["company_name", "document_url", "playbook_record_id"],
    "properties": {
      "company_name": {
        "type": "string",
        "description": "The company name to match against the document"
      },
      "document_url": {
        "type": "string",
        "description": "Google Docs URL of the playbook document"
      },
      "playbook_record_id": {
        "type": "string",
        "description": "Bubble record ID for the target playbook"
      }
    }
  },

  "steps": [
    {
      "id": "validate_target",
      "description": "Verify the target record exists in the database",
      "execution": "auto",
      "agent_involvement": "none — engine handles this internally"
    },
    {
      "id": "fetch_document",
      "description": "Fetch and normalize the source document",
      "execution": "auto",
      "agent_involvement": "none — engine handles this internally"
    },
    {
      "id": "verify_identity",
      "description": "Verify the document belongs to the target company",
      "execution": "auto",
      "agent_involvement": "only if confidence is below threshold —
        engine will return confirm_required and you must show the
        identity check results to the user",
      "possible_gate": {
        "gate_type": "human_confirmed",
        "choices": ["continue", "cancel"],
        "when": "identity confidence below 70"
      }
    },
    {
      "id": "build_extraction_input",
      "description": "Assemble document text and field definitions",
      "execution": "auto",
      "agent_involvement": "none — but the response contains the
        extraction input you will use in the next step"
    },
    {
      "id": "store_candidates",
      "description": "Submit your extracted candidates for validation",
      "execution": "agent",
      "agent_involvement": "YOU do this — extract fields from the
        document text delivered in the previous step, then submit",
      "input_schema": {
        "required": ["candidates", "document_hash"],
        "properties": {
          "candidates": {
            "type": "array",
            "description": "Extracted field candidates",
            "items": {
              "required": ["field_id", "value", "verbatim_quote"],
              "properties": {
                "field_id": { "type": "string" },
                "value": { "type": "string" },
                "verbatim_quote": {
                  "type": "string",
                  "description": "Exact quote from the document"
                },
                "confidence": { "type": "number" },
                "source_section": { "type": "string" }
              }
            }
          },
          "document_hash": {
            "type": "string",
            "description": "SHA-256 hash from the extraction input
                           response — must match"
          },
          "extraction_trace": {
            "type": "array",
            "description": "Per-field trace of cues tried and
                           matches found"
          }
        }
      },
      "instructions": "Extract fields from
        data.extraction_input.document_text using the field
        definitions in data.extraction_input.fields. For each
        field, search for positive_cues as literal substrings.
        Include a verbatim_quote for every candidate. Include
        the document_hash from the extraction input response."
    },
    {
      "id": "validate_candidates",
      "description": "Validate extracted candidates against
                      the source document",
      "execution": "auto",
      "agent_involvement": "none — engine validates verbatim quotes"
    },
    {
      "id": "confirm_update",
      "description": "Show validation results and get user
                      confirmation before writing",
      "execution": "agent",
      "agent_involvement": "show the validation report to the user
                           and wait for confirmation",
      "gate": {
        "gate_type": "human_confirmed",
        "choices": ["confirm", "cancel"],
        "message_template": "Review the {accepted_count} accepted
          fields. Confirm to write to the database, or cancel."
      }
    },
    {
      "id": "persist_update",
      "description": "Write accepted fields to the database",
      "execution": "auto",
      "agent_involvement": "none — engine writes after confirmation"
    },
    {
      "id": "get_summary",
      "description": "Return the final run summary",
      "execution": "auto",
      "agent_involvement": "none — engine produces summary"
    }
  ],

  "agent_steps_summary": {
    "total_steps": 9,
    "auto_steps": 7,
    "agent_steps": 2,
    "agent_step_ids": ["store_candidates", "confirm_update"],
    "explanation": "The engine handles 7 of 9 steps internally.
      You will only be called for store_candidates (to perform
      extraction) and confirm_update (to get user confirmation).
      All other steps execute automatically."
  },

  "rules": [
    "When you receive a response with next_action, follow the instruction exactly.",
    "When you receive status 'confirm_required', STOP and show the preview to the user. Wait for their response. Then call submit_human_response with their choice and the gate_id.",
    "Do NOT auto-confirm any human gate. The user must decide.",
    "Do NOT ask the user for permission between steps unless the system tells you to.",
    "When build_extraction_input returns extraction data, YOU perform the extraction using the document text in the response. Do not delegate to a sub-agent.",
    "When submitting candidates, include the document_hash from the extraction input response. A hash mismatch will reject all candidates.",
    "Include a verbatim_quote from the source document for every candidate. Quotes not found in the document will be rejected."
  ],

  "error_handling": {
    "on_provide_input": "The engine rejected your input. Read the error details — they tell you exactly what was wrong (field name, expected type, received type). Fix the input and call the step again.",
    "on_report_to_user": "Something failed that you can't fix. Show the error message to the user and wait for their guidance.",
    "on_resolve_precondition": "A prerequisite step hasn't completed. The error includes which precondition failed and what step to call. Follow the suggestion.",
    "on_stop": "A critical error occurred. Report it to the user and do not attempt any further steps.",
    "on_wait_for_human": "A human decision is needed. Show the gate preview to the user and call submit_human_response with their choice."
  },

  "quick_start": "Call start_run with params: company_name, document_url, playbook_record_id. The engine will run the first 4 steps automatically and return at store_candidates with the document text and field definitions. Extract candidates and submit them. The engine validates and returns results at confirm_update for user approval."
}
```

**What each section provides to the agent:**

`params_schema` — the agent knows what parameters to collect from the user before calling `start_run`. If the user says "update the PMI Georgia playbook from this doc" but doesn't provide a record ID, the agent knows to ask.

`steps` — every step listed with execution mode and agent involvement in plain English. Auto steps say "none — engine handles this." Agent steps describe exactly what the agent does. Steps with possible gates describe when the gate fires and what choices are available.

`agent_steps_summary` — quick overview: "7 of 9 steps are auto, you only get called for 2." Prevents the agent from trying to call auto steps.

`input_schema` per agent step — the agent knows exactly what params to send. Constructs correct inputs without trial and error.

`instructions` per agent step — plain English telling the agent what to do at this specific step. Step-level guidance available before the workflow starts.

`rules` — behavioral constraints. Don't auto-confirm, include the hash, don't delegate extraction. These replace the skill file's workflow instructions.

`error_handling` — maps each `agent_action` from the error taxonomy to a plain English instruction. The agent doesn't need to know the error taxonomy — it reads the instruction for the action it received.

`quick_start` — one-paragraph summary of the entire workflow from the agent's perspective. The agent reads this before the first step to understand the overall flow.

**How the protocol is generated from the workflow YAML:**

| Protocol field | Source in YAML |
|---------------|---------------|
| `params_schema` | Workflow's `start_run` parameter definition |
| `steps[].execution` | Step's `execution` field |
| `steps[].agent_involvement` | Generated from `execution` mode + `gate_config` |
| `steps[].input_schema` | Step's `input_schema` field |
| `steps[].instructions` | Step's `next_action_template` or `description` |
| `steps[].gate` / `steps[].possible_gate` | Step's `gate_config` + `trust_level` |
| `agent_steps_summary` | Computed: count auto vs agent steps |
| `rules` | `protocol.rules` section |
| `error_handling` | Generated from error taxonomy (same for all workflows unless overridden) |
| `quick_start` | Generated from step list + execution modes, or `protocol.quick_start` override |

A workflow author can override any generated field by including it in the YAML's `protocol` section. Custom `quick_start` text replaces the auto-generated version.

**How the agent uses the protocol:**

```
1. Agent calls list_workflows()
   → sees "playbook-extraction"

2. Agent calls get_workflow_protocol("playbook-extraction")
   → receives the full protocol

3. Agent reads quick_start: "Call start_run with company_name,
   document_url, playbook_record_id..."

4. Agent reads params_schema: three required params
   → collects them from user's message or asks for missing ones

5. Agent calls start_run with params

6. Engine runs auto steps 1-4 internally
   → returns at store_candidates with extraction input

7. Agent already knows what store_candidates expects
   (read the input_schema and instructions in step 2)
   → extracts fields, submits candidates

8. Engine validates, returns at confirm_update

9. Agent already knows confirm_update is a human gate
   (read the gate config in step 2)
   → shows preview to user, waits, calls submit_human_response
```

The agent has everything it needs from step 2. No trial and error. No discovering requirements by getting errors. The protocol is a complete briefing delivered before the workflow starts.

### The skill file (bootstrap only)

The skill file on the user's machine becomes very short. It no longer contains the full workflow instructions — those come from `get_workflow_protocol` via the MCP server. The skill file just tells the agent that the MCP server exists and how to start:

```markdown
# Realm Skill

## What this does
Executes guided workflows with full verification and audit trails.

## How to use
1. Connect to the realm MCP server
2. Call list_workflows to see available workflows
3. Call get_workflow_protocol with the workflow ID to get full instructions
4. Call start_run with the workflow ID and parameters
5. Follow the next_action in each response until the workflow completes

## MCP Server
URL: http://localhost:3100 (local)
URL: https://api.sensigo.dev/realm (cloud)
```

This means you can update workflows (add steps, change rules, adjust thresholds) without touching the skill file on every user's machine. The agent gets the latest protocol every time it connects.

---

## Part 6: Resources and External Services

### The resource model

Workflows interact with external resources: documents to fetch, databases to write to, APIs to call, schemas to load. These resources exist somewhere else — the engine doesn't own them. But the engine needs to manage access to them for three reasons: audit (recording exactly what was used), security (protecting credentials), and consistency (ensuring the agent works from the same data the engine validates against).

### Three trust levels for resources

**engine_delivered** — the engine fetches the resource, converts it to a canonical format, stores an authoritative snapshot, and delivers the content directly to the agent in the step response. The agent works from what the engine gave it, not from its own fetch.

Used for: source documents, any content that validation depends on. This eliminates format mismatches between what the engine has and what the agent sees.

How it works:
```
1. Engine reads the service config from the workflow definition
2. Engine fetches the URL using stored credentials
3. Engine runs the processing pipeline (format conversion,
   normalization, etc.)
4. Engine computes SHA-256 hash of the final content
5. Engine stores the full content + hash in the run record
6. Engine includes the content in the step response to the agent
7. Agent works from the delivered content
8. When agent submits results, it includes the hash
9. Engine verifies the hash matches its authoritative copy
```

**agent_fetched** — the agent retrieves the resource. The engine snapshots what the agent returns. Used for: schemas, config files, reference materials where the consequences of a mismatch are caught by downstream validation.

**engine_managed** — the engine holds the credentials and makes the API call. The agent never sees the credentials or touches the external service directly. It just says what it wants (e.g., "write these fields") and the engine executes the request, records the full HTTP request/response, and returns the result.

Used for: database writes, external API calls, anything with secrets or destructive operations.

How it works:
```
1. Agent calls execute_step with command "write_to_database"
   and params: { fields: [{ field_id: "leasing_fee", value: "$650" }] }
2. Engine loads the service config from the workflow definition
3. Engine reads API credentials from the secrets store
   (locally: .env file or config JSON)
   (cloud: encrypted secrets in the database)
4. Engine validates: are these fields allowed by the schema?
   Is the run in the correct state? Is this human_confirmed?
5. Engine builds the HTTP request from the service template
6. Engine makes the API call (e.g., PATCH to Bubble)
7. Engine records the full request and response in the evidence chain
8. Engine returns the result to the agent
   (agent never sees the API key or the raw HTTP exchange)
```

### Hash verification for document integrity

When the engine delivers a document to the agent (engine_delivered), it also tells the agent the SHA-256 hash. When the agent later submits results (e.g., extracted field candidates), it must include the hash of the document it processed. The engine compares the two:

- **Match**: the agent processed the same document the engine stored. Proceed.
- **Mismatch**: the agent may have used a cached version, a truncated copy, or different content. Reject the submission with an error.

This catches accidental mismatches (stale cache, truncation). Verbatim quote validation provides a second layer — even if the agent reports the hash dishonestly, quotes extracted from different text won't match the engine's authoritative copy.

### Service definitions in the workflow

Services are configured in the workflow YAML. Simple services use URL templates. Complex services use adapters.

Simple service (generic REST API):
```yaml
services:
  database:
    type: rest
    auth:
      type: bearer
      token_from: secrets.bubble_api_key
    base_url: "https://app.bubble.io/api/1.1"
    trust: engine_managed
    operations:
      read_record:
        method: GET
        url_template: "{base_url}/obj/playbook/{record_id}"
        response_format: json
      write_fields:
        method: PATCH
        url_template: "{base_url}/obj/playbook/{record_id}"
        request_body_from: step.validated_fields
        response_format: json
```

Complex service (needs special handling):
```yaml
services:
  document_source:
    adapter: google_docs
    auth:
      token_from: secrets.google_api_key
    trust: engine_delivered
    processing_pipeline:
      - step: normalize_text
        config:
          smart_quotes: true
          dashes: true
      - step: compute_hash
        config:
          algorithm: sha256
```

Adapters are small code modules that handle service-specific quirks (extracting doc IDs from Google URLs, handling redirects, mapping field keys with trailing spaces in Bubble, etc.). The platform ships with built-in adapters for common services. Developers can write custom adapters for unusual services.

### Processing pipelines

Resources can be transformed after fetching (inbound) or before sending (outbound) through a processing pipeline. Each processor receives the output of the previous one.

Inbound example (PDF document → clean markdown for the agent):
```
Engine fetches URL → raw PDF bytes
  ↓
pdf_to_markdown → markdown string
  ↓
strip_headers_footers → cleaned markdown
  ↓
normalize_text → normalized markdown
  ↓
compute_hash → hash added to metadata
  ↓
Engine stores final result + hash in run record
Engine delivers clean markdown to the agent
```

Outbound example (agent's field updates → Bubble API payload):
```
Agent submits field updates
  ↓
map_field_keys → maps canonical IDs to Bubble's API keys
  ↓
validate_payload → checks all fields are non-empty and in schema
  ↓
Engine sends PATCH request to Bubble
Engine records request + response in evidence chain
```

### Custom processors (post-processing hooks)

The platform ships with built-in processors: pdf_to_markdown, normalize_text, compute_hash, strip_pages, extract_tables, html_to_markdown, map_field_keys, validate_payload, etc.

For custom processing, the developer writes a processor function:

```typescript
import { ProcessorFn } from '@sensigo/realm';

export const redactSsn: ProcessorFn = async (content, config) => {
  const redacted = content.text.replace(
    /\b\d{3}-\d{2}-\d{4}\b/g,
    '[SSN REDACTED]'
  );
  return {
    text: redacted,
    metadata: {
      ...content.metadata,
      redactions_applied: ['ssn'],
      redaction_count: /* count of replacements */
    }
  };
};
```

Registers it with the engine:
```typescript
engine.registerProcessor('redact_ssn', redactSsn);
```

Uses it in the workflow definition:
```yaml
processing_pipeline:
  - step: pdf_to_markdown        # built-in
  - step: normalize_text          # built-in
  - step: redact_ssn              # custom
    config:
      patterns: ["ssn", "phone"]
  - step: compute_hash            # built-in, always last
```

Constraint: compute_hash must always be the last processor in the pipeline. The hash must reflect the final content that the agent receives. If compute_hash isn't last, the engine adds it automatically and logs a warning.

Every processor's execution is recorded in the evidence snapshot — input size, output size, what changed, duration. This means when debugging a failed extraction, you can see whether the PDF conversion dropped a table, whether normalization mangled a cue string, or whether a custom processor accidentally removed content the agent needed.

### Custom processors in the cloud — the security problem

The custom processor pattern described above works well locally — everything runs on the developer's machine, they can register whatever code they want. The cloud case is fundamentally different: the workflow engine runs on our servers, and we can't let anyone upload arbitrary code and execute it. Someone could upload code that reads other users' data, makes unauthorized network calls, mines cryptocurrency, or crashes the server.

Four approaches were evaluated:

**Approach 1: No custom code in cloud (recommended for launch)**

The cloud version only runs built-in processors that we wrote and audited. If a developer needs custom processing, they run the engine locally (the npm package) where they can register whatever code they want. The cloud version offers a rich library of built-in processors that cover most use cases.

```
Local (npm package):
  - All built-in processors available
  - Developer can register custom processors in code
  - Full flexibility, no security concerns (it's their machine)

Cloud (hosted service):
  - Only built-in processors available
  - Developer configures them via YAML (parameters, order, options)
  - No custom code execution on our servers
  - If they need custom processing, they run locally
    or request that we add a new built-in processor
```

Trade-off: some developers will hit the ceiling of built-in processors and either stay on the local version (no revenue) or ask us to build what they need (support burden). But this is also a product signal — the most-requested custom processors become the next built-in ones.

This is the safest starting point and the right answer for launch.

**Approach 2: Sandboxed code execution in cloud (future)**

The developer uploads their custom processor as a JavaScript/TypeScript function. We execute it in a sandboxed environment that restricts what the code can do.

```
1. Developer writes a processor function
2. Developer uploads it via the dashboard or CLI:
   realm deploy-processor redact-ssn ./processors/redact-ssn.ts
3. Our cloud service stores the code
4. When a workflow runs and hits that processor step:
   - Engine spins up a sandboxed runtime
     (V8 isolate like Cloudflare Workers, or WebAssembly sandbox)
   - Passes the content in as input
   - Runs the function with restrictions:
     • No network access (can't call external URLs)
     • No file system access (can't read other users' data)
     • Memory limit (e.g., 128MB)
     • Time limit (e.g., 10 seconds)
     • No access to the engine's internal state or other runs
   - Captures the output
   - Kills the sandbox
5. Engine receives the processed content and continues the pipeline
```

The technology exists — Cloudflare Workers uses V8 isolates for exactly this purpose. Deno also runs untrusted code in sandboxed V8. AWS Lambda with minimal permissions is another option. The sandbox guarantees that custom code can only see the input it's given and only produce output — it can't escape.

Trade-off: adds real complexity to the infrastructure. Building and maintaining a sandboxed execution environment is weeks of engineering. It also limits what custom processors can do — if a processor needs to call an external API (like an OCR service), it can't, because the sandbox blocks network access.

Right approach eventually, but not for launch.

**Approach 3: Webhook processors — custom code runs on developer's infrastructure (recommended second step)**

The developer hosts their custom processor as an HTTP endpoint on their own server. The cloud engine calls it during the pipeline — sends the content as a POST request, receives the processed content back.

```
Workflow definition:
  processing_pipeline:
    - step: pdf_to_markdown           # built-in, runs on our servers
    - step: custom_webhook            # runs on developer's server
      config:
        url: "https://my-server.com/processors/redact-ssn"
        timeout: 30s
        auth:
          type: bearer
          token_from: secrets.processor_auth_token
      data_leaves_platform: true      # explicit acknowledgment
    - step: compute_hash              # built-in, runs on our servers

What happens at runtime:
1. Engine finishes pdf_to_markdown, has markdown content
2. Engine POSTs to https://my-server.com/processors/redact-ssn
   with body: { content: "the markdown text", config: { ... } }
   and auth header from the developer's stored secret
3. Developer's server processes the content (redacts SSNs)
4. Developer's server returns: { content: "redacted text", metadata: { ... } }
5. Engine receives the response, continues the pipeline
6. Evidence snapshot records: called webhook at URL,
   sent N bytes, received M bytes, took X ms
```

This is architecturally clean — we never run untrusted code, the developer has full flexibility, security is their responsibility on their own server. The engine just needs an HTTP client that POSTs to a URL and receives a response — no sandbox infrastructure needed.

Trade-off: adds latency (extra HTTP round-trip per custom processor), requires the developer to host and maintain an endpoint, and the endpoint needs to be reliable (if it's down, the workflow fails).

Security considerations for the webhook approach:

The content sent to the developer's webhook may contain sensitive data from the document being processed. The engine must:
- Use HTTPS only (reject HTTP webhook URLs)
- Authenticate the request so the developer's server knows it's really from us (send a signature header using a shared secret, similar to how Stripe signs webhook payloads)
- Let the developer restrict which workflows can call their webhook
- Log every webhook call in the evidence chain so the audit trail shows that content was sent to an external endpoint

The `data_leaves_platform: true` flag in the workflow definition makes the developer explicitly acknowledge that content is being sent externally. This flag is:
- Required — the engine rejects webhook processor steps that don't include it
- Shown prominently in the dashboard when inspecting run logs
- Included in the evidence snapshot so auditors can see exactly where data went during a run
- Displayed as a warning when the developer registers the workflow: "This step sends document content to an external URL. Content will leave the Realm infrastructure."

**Approach 4: Processor marketplace (far future)**

Developers publish processors to a registry (like npm for processors). Other developers use them by referencing the registry ID. We review and audit published processors before they're available.

```
Workflow definition:
  processing_pipeline:
    - step: pdf_to_markdown                    # built-in
    - step: registry/acme-corp/redact-pii      # from the registry
      config:
        patterns: ["ssn", "phone", "email"]
    - step: compute_hash                       # built-in
```

This is a full ecosystem play — a marketplace with review processes, versioning, a registry service, and trust management. Powerful but requires the sandbox infrastructure from Approach 2 plus significant platform work. Way too much for launch.

### Custom processors — implementation roadmap

The four approaches map to the build phases:

| Phase | Approach | What ships |
|-------|----------|------------|
| Launch (Phase 1-4) | Approach 1: Built-in only | Rich library of built-in processors. Custom processing via local npm package only. |
| First cloud upgrade (Phase 5+) | Approach 3: Webhooks | Developers host custom processors on their servers. Engine calls them via HTTPS. |
| Scale phase | Approach 2: Sandboxed execution | Developers upload code. Engine runs it in V8 isolates with restrictions. |
| Ecosystem phase | Approach 4: Marketplace | Community-published processors with review and auditing. |

### Handling large documents

The current clozr workflow handles a 34K character document — fits comfortably in any modern LLM's context window. But the platform needs to handle much larger content: 200-page contracts (500K+ chars), employee handbooks (1M+ chars), or collections of documents that need cross-referencing. The engine can fetch and store these — storage is cheap. The problem is delivering them to the agent, whose context window has a hard limit and whose attention degrades on long content (the "lost in the middle" problem).

Three scenarios, each needing a different solution:

**Scenario 1: Single large document (too big for one context window)**

A 200-page contract. The agent needs to extract specific fields, just like playbook extraction but much larger.

The engine can't deliver the full text in one step response. Instead, the engine breaks the document into chunks and delivers them one at a time.

How it works:
```
Step: build_extraction_input (for a large document)

Engine sees the document is 500K characters.
Engine's chunk threshold is set in workflow config (e.g., 40K chars).
Document exceeds threshold → engine switches to chunked mode.

1. Engine splits the document into chunks.
   Not arbitrary splits — section-aware splitting:
   - Parse the document's heading structure
   - Each chunk is one or more complete sections
   - Chunks overlap slightly at boundaries (e.g., 200 chars)
     so content near section breaks isn't lost
   - Each chunk gets metadata:
     { chunk_id: "chunk_3", sections: ["Pricing", "Fee Schedule"],
       char_range: [12000, 18500], char_count: 6500 }

2. Engine stores all chunks in the run record.

3. Engine returns a chunked extraction plan to the agent:
   {
     status: "ok",
     data: {
       mode: "chunked",
       total_chunks: 12,
       total_chars: 487000,
       chunk_manifest: [
         { chunk_id: "chunk_1", sections: ["Introduction", "Parties"],
           char_count: 41000 },
         { chunk_id: "chunk_2", sections: ["Terms", "Conditions"],
           char_count: 38000 },
         ...
       ],
       fields: [ ... all field definitions with cues ... ]
     },
     next_action: "Process chunks one at a time. Call execute_step
                   with command 'get_chunk' and chunk_id 'chunk_1'.
                   Extract fields from that chunk. Then call 'get_chunk'
                   with chunk_id 'chunk_2'. Continue until all chunks
                   are processed. Then call 'submit_all_candidates'
                   with your combined results."
   }

4. Agent calls get_chunk for each chunk:
   → Engine returns the chunk text + the field definitions
   → Agent extracts candidates from that chunk
   → Agent accumulates candidates locally

5. Agent calls submit_all_candidates with combined results:
   → Engine receives candidates from across all chunks
   → Engine deduplicates (same field found in multiple chunks)
   → Engine validates verbatim quotes against the correct chunk
   → Engine proceeds with normal validation flow
```

Key design decisions for chunked delivery:

Section-aware splitting, not arbitrary. If you split at character 40,000, you might cut a sentence in half — and verbatim quote validation will fail because the quote spans two chunks. Section-aware splitting means chunks break at heading boundaries. The processing pipeline needs a `split_sections` processor that understands document structure (headings in markdown, section breaks in plain text).

The engine manages the chunking, not the agent. The agent doesn't decide how to split the document. The engine splits it, stores the chunks, and feeds them one at a time. This keeps the engine as the authority on document content.

Overlapping boundaries. A small overlap (200 chars) between adjacent chunks means content near a section break appears in both chunks. If the agent extracts a candidate from the overlap zone, the engine deduplicates based on field_id and verbatim_quote.

Quote validation needs to know which chunk. When the agent submits a candidate with a verbatim_quote, it also includes the chunk_id. The engine checks that quote against that specific chunk. The evidence snapshot records which chunk each candidate was extracted from.

**Scenario 2: Multiple documents (a collection)**

50 support articles. A set of contracts. A folder of invoices. The agent needs to search across all of them to find relevant information.

This is fundamentally different from a single large document. The agent isn't extracting from one source — it's searching across many sources and potentially combining information.

How it works:
```
Step: index_documents

1. Engine fetches all documents in the collection
2. Engine processes each one through the pipeline
   (format conversion, normalization, hashing)
3. Engine builds a simple search index:
   - For each document: title, sections, key phrases
   - Stores all document content in the run record
4. Engine returns the index to the agent:
   {
     data: {
       document_count: 50,
       index: [
         { doc_id: "doc_1", title: "Refund Policy",
           sections: ["Eligibility", "Process", "Timeline"],
           char_count: 8500 },
         { doc_id: "doc_2", title: "Shipping FAQ",
           sections: ["Domestic", "International", "Returns"],
           char_count: 12000 },
         ...
       ]
     },
     next_action: "Review the document index. For each field
                   you need to extract, identify which documents
                   are most likely to contain it based on the title
                   and section names. Then call 'get_document' with
                   the doc_id to retrieve the full text of each
                   relevant document."
   }

Step: get_document (called multiple times by the agent)

Agent requests a specific document by doc_id.
Engine returns the full text from the run record.
Agent extracts what it needs.
Agent moves to the next relevant document.
```

The agent acts as the search strategist — it looks at the index, decides which documents are relevant for which fields, and requests them one at a time. The engine acts as the librarian — it holds all the documents, serves them on request, and tracks which ones were accessed (for the audit trail).

**Scenario 3: RAG-integrated workflows (large knowledge base)**

When you have 500 documents or 10,000 support articles, you can't send a full index with section-level detail. You need actual search — the agent describes what it's looking for, and the engine returns the most relevant passages.

This is RAG (Retrieval-Augmented Generation), but integrated into the workflow engine rather than being a separate system.

How it works:
```
Step: prepare_knowledge_base (runs once at workflow start)

1. Engine checks: is this knowledge base already indexed?
   YES → skip indexing
   NO  → Engine processes all documents:
         - Fetches/reads each document
         - Runs through the processing pipeline
         - Splits into chunks (section-aware)
         - Computes embeddings for each chunk
         - Stores in a vector index
           (locally: in-memory index using hnswlib
            or simple cosine similarity search)
           (cloud: vector database like Postgres+pgvector,
            Pinecone, or Qdrant)
         - Records full document content + hashes
           in run record for audit

2. Engine returns:
   {
     data: {
       status: "knowledge_base_ready",
       document_count: 500,
       chunk_count: 4200,
       index_hash: "sha256:..."
     },
     next_action: "The knowledge base is indexed.
                   Call 'search_knowledge_base' with a query
                   to find relevant passages."
   }

Step: search_knowledge_base (called by agent as needed)

Agent calls:
{
  command: "search_knowledge_base",
  params: {
    query: "what is the leasing fee percentage",
    top_k: 5
  }
}

Engine:
1. Computes embedding for the query
2. Searches the vector index for top_k nearest chunks
3. Returns matching passages with source info:
   {
     data: {
       results: [
         {
           doc_id: "doc_23",
           doc_title: "PMI Georgia Playbook",
           chunk_id: "chunk_23_7",
           section: "Pricing",
           text: "For all of these services, we charge 10%
                  of the monthly rent collected...",
           relevance_score: 0.94
         },
         {
           doc_id: "doc_45",
           doc_title: "Fee Schedule 2024",
           chunk_id: "chunk_45_2",
           section: "Management Fees",
           text: "Standard management fee: 8.9-10.9%...",
           relevance_score: 0.87
         }
       ]
     },
     next_action: "Review these passages. Extract the field
                   value from the most relevant passage.
                   Include the doc_id and chunk_id in your
                   candidate submission for audit tracking."
   }

4. Evidence snapshot records:
   - The query that was searched
   - The top_k results returned
   - The relevance scores
   - Which documents and chunks were accessed
```

**The critical difference from standard RAG:** In a standard RAG setup, the LLM searches a vector database, gets results, and generates a response. There's no audit trail, no verification that the response came from the retrieved passages, and no way to trace a specific output back to a specific source chunk.

In this system, the RAG search is a workflow step with full evidence tracking. The engine controls the search. Every query and result is logged. When the agent submits a candidate value, it includes the doc_id and chunk_id — and the engine verifies that the verbatim quote actually appears in that specific chunk. If the agent claims it found "10% management fee" in chunk_45_2 but that text isn't there, the candidate is rejected.

This means you get auditable RAG — not just "the AI searched our knowledge base and found something" but "the AI searched for 'leasing fee percentage', found 5 passages, used passage #1 from document 'PMI Georgia Playbook' section 'Pricing', and the extracted quote is verified to exist at that location."

**Workflow configuration for document delivery strategy:**

The workflow definition controls which strategy the engine uses:

```yaml
# Small document (under threshold): deliver inline, single pass
resources:
  document:
    type: url
    trust: engine_delivered
    delivery: inline

# Large document (over threshold): chunked delivery
resources:
  document:
    type: url
    trust: engine_delivered
    delivery: chunked
    chunk_config:
      strategy: section_aware
      max_chunk_size: 40000
      overlap: 200

# Auto mode: engine decides based on document size
resources:
  document:
    type: url
    trust: engine_delivered
    delivery: auto               # inline if under threshold, chunked if over
    chunk_config:
      threshold: 40000           # switch to chunked above this
      strategy: section_aware
      max_chunk_size: 40000
      overlap: 200

# Document collection: indexed with optional search
resources:
  knowledge_base:
    type: document_collection
    trust: engine_delivered
    source: run_params.document_urls
    delivery: indexed            # build index, serve on request

# Large knowledge base: RAG with vector search
resources:
  knowledge_base:
    type: searchable_collection
    trust: engine_delivered
    index_config:
      embedding_model: "text-embedding-3-small"
      chunk_size: 1000
      chunk_overlap: 200
    search_config:
      default_top_k: 5
      min_relevance: 0.7
```

**Engine capabilities required:**

The engine needs two new capabilities to support these scenarios:

1. A chunking processor for the processing pipeline — splits documents into section-aware chunks with configurable size and overlap. This is a built-in processor, not custom code. Needs to understand heading structure in markdown, plain text section breaks, and optionally PDF page boundaries.

2. A search interface — either a built-in simple vector search (for local/small collections using an in-memory index) or an adapter for external vector databases (for cloud/large collections). This follows the same service adapter pattern as Google Docs and Bubble — the engine talks to the vector database, the agent never touches it directly.

**Implementation roadmap for large documents:**

| Phase | Capability | Complexity |
|-------|-----------|------------|
| Phase 2-3 | Scenario 1: Chunked single document — section-aware splitting, chunk management, cross-chunk deduplication | 2-3 days |
| Phase 3-4 | Scenario 2: Document collection — document registry, index building, per-document retrieval | 3-4 days |
| Phase 4-5 | Scenario 3: RAG with vector search — embedding computation, vector index, search interface, relevance scoring | 1-2 weeks |

For launch, the engine should handle Scenario 1 (chunked single document) gracefully, because someone will inevitably try to use it with a document that's too large for one context window. Scenarios 2 and 3 should be prioritized for Phase 4-5 because most AI workflows involve RAG, and auditable RAG is Realm's highest-value differentiator.

### Realm's position in the RAG ecosystem

Most AI workflows in production follow a RAG pattern: ingest documents, chunk them, embed them, store in a vector database, agent searches, agent generates an answer. The tools that handle this (LangChain, LlamaIndex, Pinecone, Weaviate, Chroma, pgvector) are mature and widely adopted.

But they all share the same blind spot: once the agent retrieves passages and generates an answer, nobody can verify where the answer came from or whether it's correct. A developer asks "the AI said the management fee is 10% — is that actually in the document?" and the current tools have no answer.

**Realm doesn't replace RAG infrastructure. It wraps it in a verified execution layer.**

The architecture:

```
Without Realm:
  Vector DB → Agent searches → Agent generates answer → ???
  (No audit trail, no verification, no evidence of source)

With Realm:
  Vector DB → Realm step: search_knowledge_base
              (engine calls vector DB, logs query + results + scores)
           → Realm step: extract_answer
              (agent works from retrieved passages, engine delivers them)
           → Realm step: validate_answer
              (engine verifies verbatim quotes exist in source chunks)
           → Realm step: human_confirm (if needed)
              (human reviews before write)
           → Evidence chain: complete audit trail from query to verified answer
```

Realm sits on top of whatever RAG stack the developer already uses. Pinecone, Chroma, pgvector, Weaviate — it doesn't matter. The engine calls the vector search through a service adapter, captures the results as evidence, delivers the passages to the agent, and verifies the agent's output against the retrieved passages.

**Why this matters commercially:**

1. Every enterprise RAG deployment needs audit trails — regulated industries (healthcare, legal, finance) can't deploy AI that generates answers from documents without proving where the answers came from.

2. The #1 RAG failure mode is "the AI hallucinated despite having the right context" — the agent got the right passages but still generated a wrong answer. Realm's quote verification catches this because the agent must provide a verbatim quote from the retrieved passage, and the engine verifies it exists.

3. The existing RAG tools provide retrieval. They don't provide verification. This is a complementary layer, not a competing one. A developer using LlamaIndex + Pinecone adds Realm to get verified, auditable RAG.

4. "Auditable RAG" is the most valuable template in the marketplace. A step template that wraps any vector database with Realm's evidence chain would be the highest-demand plugin.

**The integration pattern — a RAG workflow in Realm:**

```yaml
id: auditable-rag-extraction
name: "Auditable RAG Field Extraction"

services:
  vector_db:
    adapter: pinecone          # or chroma, pgvector, weaviate
    auth:
      token_from: secrets.pinecone_api_key
    trust: engine_managed
    config:
      index_name: "company-docs"
      namespace: run_params.company_id

  database:
    adapter: bubble
    auth:
      token_from: secrets.bubble_api_key
    trust: engine_managed

steps:
  search_documents:
    description: "Search knowledge base for relevant passages"
    execution: agent
    uses_service: vector_db
    input_schema:
      required: [queries]
      properties:
        queries:
          type: array
          items:
            type: object
            properties:
              field_id: { type: string }
              query: { type: string }
              top_k: { type: number, default: 5 }

  extract_from_passages:
    description: "Extract field values from retrieved passages"
    execution: agent
    input_schema:
      required: [candidates]
      properties:
        candidates:
          type: array
          items:
            required: [field_id, value, verbatim_quote, source_chunk_id]
            properties:
              field_id: { type: string }
              value: { type: string }
              verbatim_quote: { type: string }
              source_chunk_id: { type: string }
              source_doc_id: { type: string }
              relevance_score: { type: number }

  validate_against_sources:
    description: "Verify quotes exist in the retrieved chunks"
    execution: auto
    handler: validate_rag_candidates
    config:
      match_mode: strict
      verify_chunk_source: true    # check quote exists in claimed chunk

  confirm_and_write:
    description: "Human confirms, engine writes to database"
    execution: agent
    trust_level: human_confirmed
    gate_config:
      choices: [confirm, cancel]
```

The evidence chain for each run records: which queries were sent to the vector database, which passages were returned with relevance scores, which passages the agent selected, the verbatim quotes from those passages, verification that each quote exists in the claimed source chunk, and the human's confirmation. This is end-to-end auditability for RAG — something no existing tool provides.

**Vector database adapter as a service adapter:**

The vector DB integration follows Realm's existing service adapter pattern. The engine makes the API calls, the agent never touches the vector database directly:

```typescript
const pineconeAdapter: ServiceAdapter = {
  id: 'pinecone',
  async fetch(operation, params, config) {
    if (operation === 'search') {
      // Engine computes embedding
      const embedding = await embedText(params.query, config.embedding_model)
      // Engine queries Pinecone
      const results = await pinecone.query({
        vector: embedding,
        topK: params.top_k,
        namespace: config.namespace,
        includeMetadata: true
      })
      // Engine returns passages with full metadata
      return {
        results: results.matches.map(m => ({
          chunk_id: m.id,
          doc_id: m.metadata.doc_id,
          doc_title: m.metadata.doc_title,
          section: m.metadata.section,
          text: m.metadata.text,
          relevance_score: m.score
        }))
      }
    }
  }
}
```

The same adapter pattern works for Chroma, pgvector, Weaviate, or any other vector database. The developer registers the adapter, configures it in the workflow YAML, and the engine handles the rest.

### Integration ecosystem — what Realm connects to

Realm's service adapter pattern is deliberately uniform: the engine makes every external call, the agent never touches external systems directly, and every interaction is logged as evidence. This means every integration — regardless of the technology behind it — follows the same three-method interface (`fetch`, `create`, `update`) and produces the same evidence trail.

**Category 1: Databases and data stores (read + write)**

CRMs (Salesforce, HubSpot), ERPs (SAP, Oracle, Dynamics 365), no-code backends (Bubble, Airtable, Supabase), traditional databases (Postgres, MySQL, MongoDB), data warehouses (Snowflake, BigQuery). The agent extracts information from a source, Realm verifies it, and writes it to the target system. The current clozr workflow does this with Bubble. The pattern is identical for Salesforce or any other system.

Why developers pay for this: writing to a CRM or ERP is a high-stakes operation. An AI that writes incorrect data to Salesforce is worse than no AI at all. Realm's evidence chain proves what was written, from where, and who approved it.

```yaml
services:
  crm:
    adapter: salesforce
    auth: { token_from: secrets.sf_token }
    trust: engine_managed
    config:
      instance_url: "https://mycompany.my.salesforce.com"
```

**Category 2: Document sources (read)**

Google Docs, Google Drive, Dropbox, SharePoint, OneDrive, S3 buckets, Confluence, Notion, email attachments (via Gmail/Outlook APIs). The engine fetches documents, normalizes content, computes hashes, and delivers text to the agent. The audit trail proves which version of which document was processed, when it was fetched, and its content hash at the time of processing.

For multi-document workflows, the engine manages the collection: fetching all documents, building an index or embedding them for RAG search, and serving them to the agent on request. The agent never accesses the document source directly.

```yaml
services:
  documents:
    adapter: google_drive
    auth: { token_from: secrets.gdrive_oauth }
    trust: engine_managed
    config:
      folder_id: run_params.source_folder_id
```

**Category 3: Communication and notification (write)**

Slack, Microsoft Teams, email (SendGrid, SES, Gmail API), SMS (Twilio), webhooks. Three use cases: notifications on workflow events (run complete, step failed, gate waiting), human gate delivery (send a Slack message with approve/reject buttons when a human gate is reached), and result delivery (post extraction results to a channel after a run completes).

The webhook system (Part 7b) already handles generic notification. Dedicated Slack/Teams adapters add richer interactions — threaded messages, interactive buttons for human gates, file attachments for evidence exports.

```yaml
services:
  notifications:
    adapter: slack
    auth: { token_from: secrets.slack_bot_token }
    trust: engine_managed
    config:
      default_channel: "#data-pipeline-alerts"

webhooks:
  on_gate_waiting:
    url: https://hooks.slack.com/services/T.../B.../xxx
    body_template: |
      {"text": "Human gate waiting: {{gate_id}} on run {{run_id}}. Review: {{gate_preview}}"}
```

**Category 4: Vector databases / RAG (read + search)**

Pinecone, Chroma, pgvector, Weaviate, Qdrant, Milvus, in-memory HNSW. Covered in depth in the RAG positioning section above. The engine calls the vector database, logs every query and result with relevance scores, delivers passages to the agent, and verifies quotes against retrieved chunks.

**Category 5: Payment and financial systems (read + write)**

Stripe, QuickBooks, Xero, FreshBooks, Wave. The highest-stakes integration category. An AI agent extracts invoice line items from a PDF, Realm verifies each line item against the source document with verbatim quotes, a human gate confirms the extraction, and the engine writes to QuickBooks. Financial data is exactly where verified execution matters most — a single wrong entry can cascade through accounting.

```yaml
# Invoice extraction → QuickBooks write workflow
steps:
  extract_line_items:
    execution: agent
    input_schema:
      required: [line_items]
      properties:
        line_items:
          type: array
          items:
            required: [description, amount, verbatim_quote]

  human_review:
    execution: human_gate
    gate_config:
      type: multi_choice
      choices: [approve_all, approve_partial, reject]
      preview: extracted_line_items

  write_to_quickbooks:
    execution: auto
    uses_service: accounting
    preconditions:
      - human_review.result == "approve_all" OR human_review.result == "approve_partial"
```

**Category 6: CI/CD and DevOps (trigger + report)**

GitHub Actions, GitLab CI, Jenkins, Buildkite. Three integration points: workflow validation as a PR check (`realm validate` and `realm test` in CI), workflow triggered by CI events (a merge triggers a compliance check workflow), and test results reported back as PR status checks. The design doc already covers this in Part 8b (Testing).

**Category 7: LLM providers (the agent brain)**

OpenAI, Anthropic, Google, Mistral, Cohere, local models via Ollama/vLLM. Realm is LLM-agnostic — it communicates via MCP, which works with any AI agent regardless of the underlying model. The engine can optionally track token usage and estimated cost per step, per run, and per workflow version to help developers control AI spend.

This is a key architectural decision: Realm doesn't embed an LLM. It wraps whatever LLM the developer already uses. This means Realm works with Claude, GPT, Gemini, Llama, or a fine-tuned domain model — the developer chooses.

**Category 8: MCP gateways and agent-to-agent protocols**

MCP gateways (ContextForge, MintMCP, Tyk AI Studio), Google A2A protocol, IBM ACP protocol. Realm's MCP server can sit behind an MCP gateway for enterprise deployment — the gateway handles auth, rate limiting, and routing, while Realm handles workflow execution and evidence tracking. For multi-agent architectures, Realm can participate in A2A workflows as a specialized "verified execution agent" that other agents delegate to when they need auditable, step-by-step processing.

**The uniform integration pattern:**

Every integration, regardless of category, follows the same shape:

```
1. Developer defines the service in workflow YAML
   (adapter name, auth config, trust level)

2. Engine loads the adapter at workflow registration time

3. At runtime, the engine calls the adapter:
   - adapter.fetch(operation, params)  → read data
   - adapter.create(operation, params) → create records
   - adapter.update(operation, params) → update records

4. Engine logs the request, response, timing, errors, and
   retries as evidence in the run record

5. Agent receives the result through the ResponseEnvelope
   (never sees the raw API response, never has API credentials)
```

This means adding a new integration is a single file: implement the three methods, register the adapter, done. The engine's evidence chain, error handling, retry logic, and audit trail work automatically for every adapter.

**Adapter prioritization for the roadmap:**

| Priority | Adapter | Category | Phase | Free/Paid | Rationale |
|----------|---------|----------|-------|-----------|-----------|
| 1 | Google Docs | Document source | 1 (exists) | Free | Already built for clozr workflow |
| 2 | Bubble | Database | 1 (exists) | Free | Already built for clozr workflow |
| 3 | JSON/REST generic | Any API | 2 | Free | Covers any REST API with minimal config |
| 4 | Postgres | Database | 2 | Free | Most common database for developers |
| 5 | Slack | Notification | 2-3 | Free | Human gates via Slack, result notifications |
| 6 | Pinecone | Vector DB / RAG | 4 | Free | Drives RAG adoption (highest-value feature) |
| 7 | pgvector | Vector DB / RAG | 4 | Free | Postgres-native RAG, zero extra infrastructure |
| 8 | Chroma | Vector DB / RAG | 4 | Free | Popular open-source vector DB |
| 9 | Google Drive | Document source | 4 | Free | Multi-document collection workflows |
| 10 | Webhook (outbound) | Notification | 2 (exists) | Free | Already in design doc (Part 7b) |
| 11 | SendGrid/SES | Email | 5 | Free | Email notifications and gate delivery |
| 12 | Salesforce | CRM | 5 | $19 | Enterprise CRM, high-value integration |
| 13 | HubSpot | CRM | 5 | $9 | SMB CRM, large developer base |
| 14 | QuickBooks | Accounting | 5 | $19 | Financial data = highest-stakes verified execution |
| 15 | Stripe | Payment | 5 | $9 | Payment verification workflows |
| 16 | SharePoint | Document source | 5 | $9 | Enterprise document source |
| 17 | Airtable | Database | 5 | $9 | No-code developer audience |
| 18 | Supabase | Database | 5 | Free | Growing developer database, Postgres-based |
| 19 | SAP | ERP | 6 | $29 | Enterprise ERP, custom pricing |
| 20 | Snowflake | Data warehouse | 6 | $19 | Enterprise analytics |

Free adapters (1-11) drive adoption. Paid adapters (12-20) generate revenue. Vector DB adapters are free because they drive cloud revenue (managed RAG storage, cross-run analytics). The generic REST adapter (#3) is critical — it lets developers connect to any API without waiting for a dedicated adapter.

---

## Part 7: Workflow Definition Format

### Structure

A workflow is a directory containing:
```
my-workflow/
├── workflow.yaml     # step definitions, rules, service configs
├── schema.json       # domain-specific field definitions (optional)
└── protocol.md       # human-readable instructions for the agent (optional,
                        can be auto-generated from workflow.yaml)
```

### Workflow YAML structure

The YAML format supports progressive disclosure. A minimal workflow is 15 lines. Advanced features (preconditions, auto-execution, timeouts, retries, gate configs, input schemas) are added only when needed — everything has sensible defaults.

**Minimal example — a workflow that works with all defaults:**

```yaml
id: simple-extraction
name: "Simple Document Extraction"
description: "Fetch a document and extract fields"

services:
  document_source:
    adapter: google_docs
    auth:
      token_from: secrets.google_api_key
    trust: engine_delivered

steps:
  fetch_document:
    description: "Fetch the source document"
    uses_service: document_source
    service_operation: fetch

  extract_fields:
    description: "Extract fields from the document"
    execution: agent

  show_results:
    description: "Show extraction results to the user"
    execution: agent
```

What the engine infers from defaults:
- `execution`: agent (unless specified)
- `allowed_from_states`: previous step's `produces_state` (linear flow)
- `produces_state`: auto-generated from step name (e.g., `fetch_document_completed`)
- `trust_level`: auto
- `timeout`: 60s
- `retry`: none
- `input_schema`: none (no validation, warning in logs)
- `next_action`: auto-generated from the next step in sequence ("Call execute_step with command 'extract_fields'")
- `processing_pipeline`: none (unless specified on the service)

This minimal workflow runs. A developer can define it in under a minute and add complexity incrementally as they learn the system.

**Complete example — showing every feature:**

```yaml
id: playbook-extraction
name: "Playbook Field Extraction"
description: "Extract fields from a property management playbook
              document and write validated values to Bubble"

# Execution mode: engine runs auto steps internally,
# only returns to agent for agent steps
execution_mode: hybrid

# Services this workflow uses
services:
  document_source:
    adapter: google_docs
    auth:
      token_from: secrets.google_api_key
    trust: engine_delivered
    processing_pipeline:
      - step: normalize_text
        config:
          smart_quotes: true
          dashes: true
      - step: compute_hash
        config:
          algorithm: sha256

  database:
    adapter: bubble
    auth:
      type: bearer
      token_from: secrets.bubble_api_key
    base_url: "https://app.bubble.io/api/1.1"
    trust: engine_managed

# Schema reference
schema:
  source: file
  path: "./schema.json"
  mode: live               # re-read on every run start (development)

# Retention policy
retention:
  terminal_to_archived: 30d
  archived_to_deleted: 365d
  evict_content_on_archive: true
  evict_threshold: 10000

# Step definitions
steps:
  validate_target:
    description: "Verify the target record exists in the database"
    execution: auto
    allowed_from_states: [run_created]
    produces_state: target_validated
    pending_state: target_validation_pending
    trust_level: auto
    uses_service: database
    service_operation: read_record
    timeout: 30s
    retry:
      max_attempts: 2
      backoff: exponential
      retryable_errors: [NETWORK_*, SERVICE_HTTP_5XX]

  fetch_document:
    description: "Fetch and normalize the source document"
    execution: auto
    allowed_from_states: [target_validated]
    produces_state: document_ready
    pending_state: document_fetching
    trust_level: auto
    uses_service: document_source
    service_operation: fetch
    timeout: 60s
    retry:
      max_attempts: 3
      backoff: exponential
      retryable_errors: [NETWORK_*, SERVICE_HTTP_5XX, RESOURCE_FETCH_FAILED]

  verify_identity:
    description: "Verify the document belongs to the target company"
    execution: auto
    allowed_from_states: [document_ready]
    produces_state: identity_resolved
    pending_state: identity_verification_pending
    trust_level: human_confirmed
    handler: verify_identity
    config:
      match_strategy: word_overlap
      confidence_threshold: 70
      gate_behavior: auto_above_threshold
    preconditions:
      - check: run.document_hash exists
        explanation: "Document must be fetched first"
        auto_resolve: fetch_document
    transitions:
      on_success: build_extraction_input
      on_confirm_required: wait_for_human
      on_error: report_and_stop
    timeout: 30s

  build_extraction_input:
    description: "Assemble document text and field definitions"
    execution: auto
    allowed_from_states: [identity_resolved]
    produces_state: extraction_pending
    trust_level: auto
    preconditions:
      - check: run.identity_result.status == "confirmed"
        explanation: "Identity must be verified"
        auto_resolve: verify_identity
    context_delivers:
      - document_text
      - field_definitions
    next_action_template: >
      EXTRACT NOW. You have {field_count} fields to find.
      The document is in data.extraction_input.document_text.
      Do NOT launch a sub-agent. Do NOT ask the user.
    timeout: 10s

  store_candidates:
    description: "Submit extracted candidates for validation"
    execution: agent
    allowed_from_states: [extraction_pending]
    produces_state: candidates_stored
    trust_level: auto
    input_schema:
      required: [candidates, document_hash]
      properties:
        candidates:
          type: array
          items:
            required: [field_id, value, verbatim_quote]
            properties:
              field_id: { type: string }
              value: { type: string }
              verbatim_quote: { type: string }
              confidence: { type: number, minimum: 0, maximum: 1 }
              source_section: { type: string }
        document_hash:
          type: string
          pattern: "^sha256:"
        extraction_trace:
          type: array
    timeout: 300s

  validate_candidates:
    description: "Validate extracted candidates against document"
    execution: auto
    allowed_from_states: [candidates_stored]
    produces_state: validated
    trust_level: auto
    handler: validate_extracted_fields
    config:
      match_mode: strict
      fuzzy_fallback: true
      whitespace_normalize: true
    preconditions:
      - check: run.candidates.length > 0
        explanation: "At least one candidate must be submitted"
    transitions:
      on_success:
        condition: "data.accepted_count > 0"
        if_true: confirm_update
        if_false: report_no_candidates

  confirm_update:
    description: "Show validation results and confirm write"
    execution: agent
    allowed_from_states: [validated]
    produces_state: update_confirmed
    trust_level: human_confirmed
    gate_config:
      choices: [confirm, cancel]
      message: "Review the {accepted_count} accepted fields.
                Confirm to write to the database, or cancel."
    preconditions:
      - check: run.accepted_candidates.length > 0
        explanation: "At least one accepted candidate required"
    transitions:
      on_confirm: persist_update
      on_cancel: cancel_run
    timeout: 24h
    on_timeout: abandon

  persist_update:
    description: "Write accepted fields to the database"
    execution: auto
    allowed_from_states: [update_confirmed]
    produces_state: persisted
    pending_state: persistence_pending
    trust_level: auto
    uses_service: database
    service_operation: write_fields
    preconditions:
      - check: run.update_confirmed == true
        explanation: "Human must confirm before writing"
    timeout: 30s
    retry:
      max_attempts: 3
      backoff: exponential
      retryable_errors: [NETWORK_*, SERVICE_HTTP_5XX]

  get_summary:
    description: "Return the final run summary"
    execution: auto
    allowed_from_states: [persisted]
    produces_state: completed
    trust_level: auto
    timeout: 5s

# Protocol rules (served to agent via get_workflow_protocol)
protocol:
  rules:
    - "Execute steps in order. Do not skip steps."
    - "When you receive status 'confirm_required', STOP and show
       the preview to the user. Wait for their response. Then call
       submit_human_response with their choice."
    - "Do not ask the user for permission between steps unless
       the system tells you to."
    - "When build_extraction_input returns, YOU perform the
       extraction using the document text in the response.
       Do not delegate to a sub-agent."
    - "When submitting candidates, include the document_hash from
       the extraction input response."
  error_handling: >
    If any step returns status 'error', check the agent_action
    field. If 'provide_input', fix the input and retry. If
    'report_to_user', show the error to the user and stop.
    If 'stop', report the error and do not retry.
```

**What the complete example demonstrates:**

- `execution_mode: hybrid` — engine runs auto steps internally, only returns to agent at agent steps (store_candidates, confirm_update)
- `execution: auto` vs `execution: agent` per step — 6 of 8 steps are auto, 2 are agent
- `pending_state` — concurrency protection for slow operations
- `preconditions` with `auto_resolve` — engine automatically runs prerequisites if needed
- `transitions` with conditional branching — `validate_candidates` branches on `accepted_count > 0`
- `gate_config` with choices — `confirm_update` is a human gate with confirm/cancel
- `input_schema` — `store_candidates` validates the agent's params before executing
- `retry` policies — network-dependent steps retry on transient errors
- `timeout` per step — from 5s for fast operations to 24h for human gates
- `next_action_template` with variable interpolation — `build_extraction_input` tells the agent exactly what to do
- `handler` reference — `validate_candidates` uses a registered StepHandler
- `protocol.error_handling` references the error taxonomy's `agent_action` field
- `retention` policy — archive after 30 days, delete after 1 year, evict large content

**What a developer sees when starting out:**

They begin with the minimal example (15 lines). It works. As they hit real-world needs (the step is too slow — add timeout, the API flakes — add retry, they need human approval — add gate_config, the agent sends bad data — add input_schema), they add one feature at a time. Each addition is one or two lines in the YAML. They never need to rewrite the workflow — they just extend it.

### Schema reference handling

The schema (e.g., canonical-schema.json) can live in three places:

1. **Bundled with the workflow (default).** The schema file is in the workflow directory. When the developer registers the workflow (`realm register ./my-workflow/`), the engine copies the schema into its internal store. This is the production mode — the schema is versioned with the workflow.

2. **Live file path (development mode).** The schema points to a file on disk with `mode: live`. The engine reads it fresh on every run start. Good for rapid iteration — change a cue, re-run immediately. The engine still snapshots the schema into the run record so the audit trail is self-contained.

3. **Remote URL.** The schema lives at a URL (Git raw URL, API endpoint). The engine fetches it at run start and caches it for the duration of the run. Used when schemas are managed separately from workflows.

### Workflow registration

Before an agent can use a workflow, the developer registers it with the engine:

```bash
realm register ./my-workflow/
```

The engine reads all files in the workflow directory, validates the YAML, checks that referenced services and processors exist, and stores everything in its internal store. For local development, this is a directory under `~/.realm/workflows/`. For the cloud, it's uploaded to the database.

After registration, the MCP server can serve the workflow to any agent that connects.

### Workflow versioning and in-progress runs

When a developer re-registers a workflow (changes a threshold, adds a cue, modifies a step), what happens to runs currently in progress on the old version?

**Rule: the workflow definition is snapshotted into the run record at `start_run`. All steps in that run use the snapshot. In-progress runs are never affected by re-registration.**

This is the same pattern the design uses for schemas (snapshotted at run start) and documents (snapshotted at fetch). Each run is a self-contained execution against a specific version. The evidence chain shows exactly which version was used.

**How it works:**

```
1. Developer registers workflow (version auto-increments to v3)
   realm register ./my-workflow/

2. Agent calls start_run
   Engine reads current registered workflow (v3)
   Engine snapshots full definition into run record:
     run.workflow_version = 3
     run.workflow_snapshot = { steps: [...], services: [...], ... }

3. Developer updates workflow, re-registers (now v4)
   realm register ./my-workflow/

4. In-progress run continues using v3 snapshot
   Every execute_step reads from run.workflow_snapshot
   The run doesn't know v4 exists

5. New runs started after re-registration use v4
   Their run records snapshot v4
```

**Why not pick up the new version mid-run:**

If the developer changed a step's `produces_state` name, an in-progress run in the old state would have no matching transitions — the new workflow doesn't know about the old state. The run breaks silently. If the developer changed an input schema for a step that already executed, the evidence chain would show inputs that don't match the current schema. Too dangerous.

**Why not fail in-progress runs on re-registration:**

Too aggressive. A developer who fixes a typo in a description shouldn't kill three in-progress runs. A developer iterating on thresholds shouldn't wait for all runs to complete before re-registering.

**The registered workflow record:**

```typescript
interface RegisteredWorkflow {
  workflow_id: string
  version: number              // auto-increments on each realm register
  registered_at: string
  definition: WorkflowDefinition
}
```

The run record stores the version number and full snapshot:

```typescript
interface RunRecord {
  // ... existing fields ...
  workflow_version: number              // which version was snapshotted
  workflow_snapshot: WorkflowDefinition // full definition at run start
}
```

**Behavior for different operations:**

| Operation | Which workflow version is used |
|-----------|------------------------------|
| `start_run` | Current registered version (snapshotted into run record) |
| `execute_step` on in-progress run | Run's snapshot (not current registered) |
| `realm test` with fixtures | Current registered version (tests validate what you just changed) |
| `realm replay` on a past run | Run's snapshot (shows what would change in that specific run) |
| `realm resume` (default) | Run's original snapshot (safe, no mid-run version change) |
| `realm resume --use-current-workflow` | Current registered version (explicit upgrade) |

**Resume with workflow upgrade:**

If a run failed on v3 and the developer re-registers v4 to fix the issue, resume should use the fix. But this must be explicit — the default is safe (use original snapshot):

```bash
# Default: resume using original workflow snapshot
realm resume run-abc-123 --from fetch_document

# Explicit upgrade: resume using current registered workflow
realm resume run-abc-123 --from fetch_document --use-current-workflow
```

When `--use-current-workflow` is used, the engine updates `workflow_version` and `workflow_snapshot` in the run record and adds an entry to the evidence chain: "Workflow upgraded from v3 to v4 at resume point fetch_document." The developer explicitly accepts the risk of a mid-run version change.

**For cloud version management:**

The cloud dashboard groups runs by `workflow_version` and computes metrics per group. This is how "v1.0: 67% success rate (47 runs), v1.1: 74% (31 runs)" works — the version is already in every run record from the snapshot mechanism.

---

## Part 7b: Outbound Events and Webhooks

The engine can notify external systems when things happen during a workflow run — run completion, step failures, human gates triggered. This is separate from webhook processors (Part 6, which handle custom document processing). This is about events: something happened, and the developer wants an external system to know.

### Event types

The engine produces events at three levels:

```
Run-level events:
  run.started         — new run created and executing
  run.completed       — terminal state: completed
  run.failed          — terminal state: failed
  run.cancelled       — terminal state: cancelled
  run.abandoned       — terminal state: abandoned (timeout)

Step-level events:
  step.started        — a step began executing
  step.completed      — a step finished successfully
  step.failed         — a step failed (retries exhausted)
  step.retrying       — a step failed but is being retried

Gate events:
  gate.opened         — human gate triggered, waiting for response
  gate.responded      — human responded to a gate
  gate.timed_out      — gate timed out without response
```

### Webhook configuration in workflow YAML

The developer subscribes to events and provides target URLs:

```yaml
webhooks:
  - events: [run.completed, run.failed]
    url: "https://my-server.com/hooks/workflow-status"
    auth:
      type: bearer
      token_from: secrets.webhook_token

  - events: [gate.opened]
    url: "https://my-server.com/hooks/approval-needed"
    auth:
      type: bearer
      token_from: secrets.webhook_token

  - events: [run.completed]
    url: "https://hooks.slack.com/services/T00/B00/xxx"
    method: POST
    body_template:
      text: "*Playbook updated: {run_params.company_name}*\n• {event_data.summary.accepted_fields} fields written\n• {event_data.summary.rejected_fields} rejected"
```

### Webhook payload structure

Every webhook receives a standard payload with event type, run context, and event-specific data.

Run completed:
```json
{
  "event": "run.completed",
  "timestamp": "2025-03-30T14:25:30Z",
  "workflow_id": "playbook-extraction",
  "run_id": "abc-123",
  "workflow_version": 3,
  "run_context": {
    "params": {
      "company_name": "PMI Georgia",
      "document_url": "https://docs.google.com/..."
    },
    "started_at": "2025-03-30T14:20:00Z",
    "duration_seconds": 330
  },
  "event_data": {
    "terminal_state": "completed",
    "summary": {
      "total_steps": 9,
      "accepted_fields": 11,
      "rejected_fields": 3,
      "not_found_fields": 8
    }
  }
}
```

Gate opened:
```json
{
  "event": "gate.opened",
  "timestamp": "2025-03-30T14:23:00Z",
  "workflow_id": "playbook-extraction",
  "run_id": "abc-123",
  "run_context": {
    "params": { "company_name": "PMI Georgia" },
    "current_step": "confirm_update"
  },
  "event_data": {
    "gate_id": "gate_a1b2c3",
    "gate_type": "human_confirmed",
    "choices": ["confirm", "cancel"],
    "preview_summary": "11 fields accepted, 3 rejected",
    "timeout_at": "2025-03-31T14:23:00Z"
  }
}
```

Step failed:
```json
{
  "event": "step.failed",
  "timestamp": "2025-03-30T14:22:06Z",
  "workflow_id": "playbook-extraction",
  "run_id": "abc-123",
  "run_context": {
    "params": { "company_name": "PMI Georgia" },
    "current_step": "persist_update"
  },
  "event_data": {
    "step_id": "persist_update",
    "error": {
      "code": "SERVICE_HTTP_5XX",
      "message": "Bubble API returned HTTP 503 after 3 attempts",
      "attempts": 3
    }
  }
}
```

### Custom payloads with `body_template`

Some targets (Slack, Discord, PagerDuty) expect specific formats. The `body_template` field defines a custom payload using variable interpolation against the standard payload:

```yaml
webhooks:
  - events: [run.completed]
    url: "https://hooks.slack.com/services/T00/B00/xxx"
    body_template:
      text: "*Playbook updated: {run_params.company_name}*\n• {event_data.summary.accepted_fields} fields written"

  - events: [step.failed]
    url: "https://my-pagerduty.com/webhook"
    body_template:
      routing_key: "R00xxx"
      event_action: "trigger"
      payload:
        summary: "Workflow {workflow_id} failed at {event_data.step_id}: {event_data.error.message}"
        severity: "error"
        source: "realm"
```

If `body_template` is omitted, the engine sends the standard payload.

### Webhook delivery

Webhooks are fire-and-forget with retry. The engine does not wait for the webhook response before continuing the workflow — webhooks are notifications, not gates.

```
1. Event occurs (e.g., run.completed)
2. Engine checks: are there webhook subscriptions for this event?
3. For each matching subscription:
   a. Build the payload (standard or from body_template)
   b. POST to the URL with auth headers
   c. If request fails (network error, HTTP 5xx):
      - Queue for retry (3 attempts, exponential backoff)
      - Log the failure in evidence chain
   d. If request succeeds (HTTP 2xx):
      - Log the delivery in evidence chain
4. Engine continues (does not block on webhook delivery)
```

Evidence chain records every delivery attempt:

```json
{
  "webhook_deliveries": [
    {
      "event": "run.completed",
      "url": "https://hooks.slack.com/services/T00/B00/xxx",
      "status": "delivered",
      "http_status": 200,
      "sent_at": "2025-03-30T14:25:31Z",
      "response_time_ms": 340
    },
    {
      "event": "run.completed",
      "url": "https://my-server.com/hooks/workflow-status",
      "status": "failed",
      "attempts": 3,
      "last_error": "NETWORK_TIMEOUT",
      "first_attempt_at": "2025-03-30T14:25:31Z",
      "last_attempt_at": "2025-03-30T14:25:38Z"
    }
  ]
}
```

### Webhook security

HTTPS only — engine rejects HTTP webhook URLs.

Request signing — every webhook includes a signature header so the receiver can verify the sender:

```
POST /hooks/workflow-status HTTP/1.1
Content-Type: application/json
Authorization: Bearer <webhook_token>
X-VA-Signature: sha256=a1b2c3d4...
X-VA-Timestamp: 2025-03-30T14:25:31Z
```

The signature is `HMAC-SHA256(webhook_secret, timestamp + "." + payload_json)`. The receiver computes the same HMAC with its copy of the secret and compares. Prevents forged webhook calls.

Event webhooks have lower data exposure than processor webhooks (Part 6) — they send summaries and metadata, not document text or extracted values. The developer controls what's in the payload via `body_template`.

### Internal event bus architecture

The engine emits events through an internal event bus — a list of listeners. Different listeners are added in different phases:

```typescript
interface EngineEvent {
  type: string              // "run.completed", "step.failed", etc.
  timestamp: string
  run_id: string
  workflow_id: string
  data: Record<string, any>
}

interface EventListener {
  on_event(event: EngineEvent): Promise<void>
}
```

| Phase | Listener | Purpose |
|-------|----------|---------|
| Phase 1 | Evidence capture | Records events in the run record |
| Phase 2 | Webhook delivery | Sends HTTP POST to configured URLs |
| Phase 5 | Real-time stream | Pushes to WebSocket/SSE for cloud dashboard |

The event bus is designed in Phase 1 (the evidence capture listener already processes events). Webhook delivery registers as a second listener in Phase 2. Real-time streaming registers as a third listener in Phase 5. Each listener is independent — adding one doesn't affect the others.

This means the webhook system adds no complexity to the core engine. It's a separate listener that processes the same events the evidence system already captures.

### Local vs cloud

Webhooks work locally — the engine makes HTTP calls to whatever URLs the developer configured. Useful for local development with ngrok, Slack notifications during dev runs, or triggering local scripts via a small HTTP server.

The cloud adds a webhook delivery dashboard: recent deliveries, success/failure rates, retry queue, and the ability to replay a failed delivery.

---

## Part 8: Diagnostics and Tuning

### Per-step diagnostics

Every step execution records a diagnostics payload:

```
{
  step: "extract_candidates",
  inputs_snapshot: { ... },        # exactly what the agent received
  outputs_snapshot: { ... },       # exactly what the agent produced
  evidence: {                      # provenance proof
    document_hash: "sha256:abc...",
    schema_version: "1.0.0",
    field_count: 22
  },
  trace: {                         # step-specific diagnostic data
    per_field: [
      {
        field_id: "leasing_fee",
        pass1_cues_tried: ["leasing fee", "placement fee"],
        pass1_match: "leasing fee",
        pass2_sections_tried: [],
        outcome: "candidate_submitted"
      }
    ],
    anomalies: [
      {
        field_id: "renewal_fee",
        anomaly: "cue 'renewal' IS in document but was NOT tried"
      }
    ]
  },
  parameter_sensitivity: {         # what would change with different settings
    confidence_threshold: {
      current: 70,
      at_60: { would_accept: ["renewal_fee"] },
      at_80: { would_reject: ["late_fee"] }
    }
  }
}
```

### The tuning loop

The developer experience for improving a workflow:

1. Run the workflow against real data
2. Open the run diagnostics (`realm inspect <run-id>`)
3. See exactly where the agent failed and why
4. Adjust specific parameters:
   - Add a positive cue to a field definition (schema change)
   - Lower a confidence threshold (workflow config change)
   - Add a section to the allowed_sections list (schema change)
   - Tighten a next_action instruction (workflow step change)
5. Re-run with the same data
6. Compare results

No prompt rewriting. No guessing. Every adjustment is a specific parameter change informed by diagnostic data.

### Replay / dry-run

The CLI supports replaying a run with modified parameters without re-executing external calls:

```bash
realm replay <run-id> --with "verify_identity.confidence_threshold=60"
```

This re-evaluates the stored evidence against the new parameters and shows what would change — without fetching the document again or calling any APIs. Useful for testing threshold changes without waiting for a full run.

---

## Part 8b: Testing

Testing in this system means different things at different levels. A developer building a workflow needs to verify structural correctness (does my YAML make sense?), unit correctness (does my step handler produce the right output for known input?), integration correctness (does the full pipeline work end-to-end against sample data?), and regression safety (did my parameter change break anything?). Each level has different requirements and different tooling.

### Level 1: Static workflow validation (`realm validate`)

Before running anything, verify the workflow definition is structurally correct. No execution, no external calls, no agent involved.

```bash
realm validate ./my-workflow/
```

What it checks:
- YAML parses correctly
- All referenced services have registered adapters
- All referenced processors exist (built-in or registered)
- All referenced step handlers exist
- Flow graph has no unreachable states
- Flow graph has no dead ends (states with no outbound transition except terminal states)
- Precondition expressions parse correctly
- Input schemas are valid JSON Schema
- Every step that uses `auto_resolve` references a step that exists and is auto-execution
- Parallel groups don't contain agent-execution steps

Output: pass/fail with specific errors. No run record created, no evidence captured, nothing executed.

This is cheap to build (parsing and graph traversal) and catches the most common errors (typos in step names, missing adapters, broken flow graphs). Phase 1.

### Level 2: Unit testing extensions (`testStepHandler`, `testProcessor`, `testAdapter`)

Test a single extension in isolation with known inputs and expected outputs. No engine, no run record, no state machine — just the function with known inputs.

**Testing a step handler:**

```typescript
import { testStepHandler } from '@sensigo/realm-testing'
import { validateFields } from './my-handlers'

testStepHandler(validateFields, {
  name: 'accepts valid quote',
  inputs: {
    params: {
      candidates: [
        { field_id: 'leasing_fee', value: '$650',
          verbatim_quote: 'we charge a leasing fee of $650' }
      ],
      document_hash: 'sha256:abc...'
    },
    run_data: {}
  },
  context: {
    resources: {
      document_text: '...we charge a leasing fee of $650...'
    },
    config: {}
  },
  expect: {
    data: {
      accepted_count: 1
    }
  }
})
```

**Testing a processor:**

```typescript
import { testProcessor } from '@sensigo/realm-testing'
import { redactSsn } from './my-processors'

testProcessor(redactSsn, {
  name: 'redacts SSN patterns',
  input: {
    text: 'Patient SSN is 123-45-6789 and DOB is 01/01/1990',
    metadata: {}
  },
  config: { patterns: ['ssn'] },
  expect: {
    text_contains: '[SSN REDACTED]',
    text_not_contains: '123-45-6789',
    metadata: { ssn_redactions: 1 }
  }
})
```

**Testing a service adapter (with HTTP mocking):**

```typescript
import { testAdapter } from '@sensigo/realm-testing'
import { airtableAdapter } from './my-adapters'

testAdapter(airtableAdapter, {
  name: 'reads a record',
  operation: 'read_record',
  params: { base_id: 'appXXX', table: 'Invoices', record_id: 'recYYY' },
  mock_http: {
    url: 'https://api.airtable.com/v0/appXXX/Invoices/recYYY',
    response: { status: 200, body: { fields: { Amount: '$500' } } }
  },
  expect: {
    status: 200,
    data: { fields: { Amount: '$500' } }
  }
})
```

The `mock_http` field intercepts HTTP calls and returns mock responses. The adapter code runs for real (builds the URL, sets headers, parses the response) but the actual network call is intercepted. This tests the adapter's logic without hitting the real API.

These utilities run with standard test frameworks (Jest, Vitest). The testing package provides the test helpers; the developer uses whatever test runner they already have.

### Level 3: Integration testing with fixtures (`realm test`)

Run the entire pipeline — all steps in order, with state transitions, evidence capture, and validation — but against sample documents and with mock API responses instead of hitting real services.

```bash
realm test ./my-workflow/ --fixtures ./test-fixtures/
```

**The fixtures directory:**

```
test-fixtures/
├── fixture.yaml                   # test configuration
├── documents/
│   ├── sample-playbook.md         # sample document (already processed)
│   └── sample-invoice.pdf         # another sample
├── mock-services/
│   ├── bubble-read.json           # mock response for database read
│   ├── bubble-write.json          # mock response for database write
│   └── google-docs-fetch.json     # mock response for document fetch
└── expected/
    ├── extraction-results.json    # expected candidates after extraction
    └── validation-results.json    # expected accepted/rejected after validation
```

**The fixture configuration:**

```yaml
# fixture.yaml
workflow_id: playbook-extraction

# Parameters for the test run
params:
  company_name: "Test Company"
  document_url: "mock://documents/sample-playbook.md"
  playbook_record_id: "test-record-001"

# Mock service responses
mock_services:
  document_source:
    fetch:
      # Instead of fetching from Google Docs, read from local file
      source_file: documents/sample-playbook.md

  database:
    read_record:
      response_file: mock-services/bubble-read.json
    write_fields:
      response: { status: "success", written_count: 5 }

# What the agent would produce at agent-execution steps
# (since there's no real agent in test mode)
agent_responses:
  extract_candidates:
    # Provide pre-built candidates as if the agent extracted them
    response_file: expected/extraction-results.json

  confirm_update:
    # Simulate user confirming
    params: { user_choice: "confirm" }

# Assertions checked after the run completes
assertions:
  - step: validate_target
    expect_status: ok

  - step: fetch_document
    expect_status: ok
    expect_data:
      char_count: { greater_than: 1000 }

  - step: verify_identity
    expect_status: ok
    expect_data:
      confidence_score: { greater_than_or_equal: 70 }

  - step: validate_candidates
    expect_status: ok
    expect_data:
      accepted_count: { greater_than: 5 }
      rejected_count: { less_than: 5 }
    expect_specific_fields:
      leasing_fee: { status: accepted, value_contains: "%" }
      management_fee: { status: accepted }
      renewal_fee: { status: rejected, reason_contains: "quote not found" }

  - step: persist_update
    expect_status: ok
    expect_data:
      written_count: { equals: 5 }

  # Evidence chain assertions
  - evidence:
      document_hash: { exists: true }
      all_steps_have_evidence: true
```

**How `realm test` works internally:**

```
1. Engine loads the workflow definition (same as production)

2. Engine creates a test run
   (same run record structure, flagged as test_mode: true)

3. Engine configures mock service layer:
   - Service adapter calls are intercepted
   - Instead of hitting real URLs, engine reads mock responses
     from fixture files
   - Document fetches read from local fixture files
     instead of fetching URLs

4. Engine runs the workflow:
   - Auto-execution steps run normally (but with mocked services)
   - Agent-execution steps use pre-built responses from
     agent_responses in the fixture
   - Human gates use simulated choices from agent_responses
   - State transitions, evidence capture, validation — all run
     exactly as in production

5. After all steps complete, engine evaluates assertions:
   - Checks each assertion against actual step outputs
   - Reports pass/fail per assertion with actual vs expected values

6. Output:
   ✓ validate_target: ok
   ✓ fetch_document: ok (char_count: 34372 > 1000)
   ✓ verify_identity: ok (confidence_score: 100 >= 70)
   ✓ validate_candidates: ok (accepted: 11 > 5, rejected: 3 < 5)
   ✓   leasing_fee: accepted, value "10%" contains "%"
   ✓   management_fee: accepted
   ✓   renewal_fee: rejected, reason contains "quote not found"
   ✓ persist_update: ok (written_count: 5 = 5)
   ✓ evidence.document_hash: exists
   ✓ evidence.all_steps_have_evidence: true

   10/10 assertions passed
```

The key design principle: `realm test` uses the real engine with the real state machine, real evidence capture, real processing pipeline, and real validation logic. Only external service calls and agent responses are mocked. The test exercises exactly the same code path as production — the only things replaced are what you can't control in a test (external APIs and the AI agent).

### Level 4: Replay with parameter changes (`realm replay`)

The developer changed a cue or threshold. They want to know: does this change improve results without running the full pipeline against real documents?

```bash
# Replay a previous run with a modified schema
realm replay run-abc-123 --with-schema ./updated-schema.json

# Replay with a modified threshold
realm replay run-abc-123 --set "verify_identity.confidence_threshold=60"

# Compare two replays
realm replay run-abc-123 --with-schema ./v1-schema.json --output run-v1.json
realm replay run-abc-123 --with-schema ./v2-schema.json --output run-v2.json
realm diff run-v1.json run-v2.json
```

How replay works internally:

```
1. Engine loads the original run record
   (all evidence snapshots intact)

2. Engine replays each step using stored evidence:
   - Engine-delivered resources: uses stored snapshot
     (not a fresh fetch)
   - Service responses: uses stored response snapshots
   - Agent submissions: uses stored candidates
   - Validation: re-runs with new parameters (new schema,
     new thresholds) against stored document and candidates

3. Engine compares replay results against original:

   Replay of run-abc-123 with updated schema:

   Improvements (3 fields):
     renewal_fee: rejected → accepted
       (new cue "lease renewal fee" matched at position 14,223)
     late_fee: rejected → accepted
       (new cue "late payment" matched at position 8,891)
     geographic_area: rejected → accepted
       (new section "Service Area" added to allowed_sections)

   Regressions (0 fields):
     (none)

   Unchanged (8 fields):
     leasing_fee: accepted → accepted
     management_fee: accepted → accepted
     ...

   Net change: +3 accepted fields (11 → 14 of 22)
```

Replay doesn't create a new run record — it creates a replay report showing what would change. No external calls, no agent involvement, no side effects. The developer can try dozens of parameter changes in seconds.

### Level 5: CI/CD integration

Automated testing on every pull request that modifies a workflow or schema:

```yaml
# .github/workflows/test.yml
name: Workflow Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install
      - run: npx realm validate ./workflows/playbook-extraction/
      - run: npx realm test ./workflows/playbook-extraction/ \
               --fixtures ./test-fixtures/playbook/
      - run: npx realm test ./workflows/invoice-extraction/ \
               --fixtures ./test-fixtures/invoice/
```

Every pull request runs `realm validate` (structural check) and `realm test` (integration test with fixtures) for each workflow. Merge only if all tests pass.

### What each testing level catches

| Testing level | What it catches | Speed | Phase |
|--------------|----------------|-------|-------|
| Level 1: `realm validate` | Typos in step names, missing adapters, broken flow graphs, invalid schemas, unreachable states | Instant (<1s) | Phase 1 |
| Level 2: Unit tests | Step handler logic errors, processor bugs, adapter URL/auth issues | Fast (seconds) | Phase 2 |
| Level 3: `realm test` | Integration issues — steps that work alone but fail together, state transition errors, evidence chain gaps, validation logic errors | Medium (seconds to minutes) | Phase 2-3 |
| Level 4: `realm replay` | Parameter regressions — cue changes that break existing extractions, threshold changes that reject previously accepted fields | Fast (seconds, no network) | Phase 3 |
| Level 5: CI/CD | Merge regressions — workflow changes that break test fixtures | Medium (runs Level 1-3) | Phase 4 |

### Engine design requirements for testing

The testing capability requires three design decisions baked into the engine from Phase 1:

**1. Mock-able service adapter interface.**

The adapter interface must support an interception point where the engine can replace real HTTP calls with mock responses:

```typescript
class MockAdapter implements ServiceAdapter {
  constructor(
    private realAdapter: ServiceAdapter,
    private mockResponses: Record<string, any>
  ) {}

  id = this.realAdapter.id

  async fetch(operation: string, params: Record<string, any>) {
    if (this.mockResponses[operation]) {
      return this.mockResponses[operation]
    }
    return this.realAdapter.fetch(operation, params)
  }
}
```

The engine's service layer checks: are we in test mode? If yes, wrap all adapters in `MockAdapter`. A few lines of code, but must be designed in from the start.

**2. Agent response injection in the step dispatcher.**

For `realm test`, agent-execution steps need to use pre-built responses instead of waiting for a real agent. The step dispatcher checks: are we in test mode and is there a pre-built response for this step? If yes, use it. Another few lines, but must be in Phase 1.

**3. Test mode flag in the run record.**

Test runs are flagged with `test_mode: true` in the run record. This ensures test runs are never confused with production runs in analytics, and the cloud dashboard can filter them separately.

### The testing package (`realm/testing`)

A separate package in the monorepo providing:

- `testStepHandler(handler, testCase)` — unit test a step handler
- `testProcessor(processor, testCase)` — unit test a processor
- `testAdapter(adapter, testCase)` — unit test an adapter with HTTP mocking
- `MockAdapter` class — wraps a real adapter with mock responses
- `FixtureLoader` — reads fixture YAML and document files
- `AssertionRunner` — evaluates assertions against step outputs
- `ReplayEngine` — re-runs validation against stored evidence with modified parameters

### Use cases enabled by testing

**Regression testing:** After changing a cue or threshold, run `realm test` to verify the change didn't break existing extractions. The fixture contains a known-good document with known-good expected results.

**Schema development:** When building a new domain schema (invoice fields, contract clauses), iterate against sample documents without hitting real APIs. Add cues, run the test, see which fields match, adjust, repeat.

**CI/CD integration:** Every pull request that modifies a workflow or schema runs the test suite. Merge only if tests pass.

**A/B comparison:** Run the same fixtures against two versions of a workflow via `realm replay` + `realm diff`. Compare extraction success rates, accepted field counts, and specific field values. This is the local-only version of the cloud's version comparison feature.

---

## Part 9: Build Plan

### Technology choices

**Language:** TypeScript. Primary consumers are AI agents in VS Code, Claude, Cursor, Windsurf — all TypeScript-native ecosystems. The npm package is the distribution channel. MCP SDK is TypeScript-first. One language end-to-end.

**Local storage:** JSON files on disk (identical pattern to the existing Python `runs/` directory).

**Cloud storage:** Postgres (Neon or Supabase free tier to start).

**Cloud hosting:** Vercel or Railway for the API + dashboard. No Durable Objects until scale demands it.

### Monorepo structure

```
realm/
├── packages/
│   ├── core/              # @sensigo/realm — the engine
│   │   ├── src/
│   │   │   ├── runtime/   # workflow executor, state guards
│   │   │   ├── evidence/  # evidence snapshots
│   │   │   ├── trust/     # trust levels, human gates
│   │   │   ├── context/   # context assembly per step
│   │   │   ├── services/  # service adapters + HTTP client
│   │   │   ├── pipeline/  # processing pipeline (inbound + outbound)
│   │   │   ├── envelope/  # ResponseEnvelope + next_action
│   │   │   └── diagnostics/
│   │   └── package.json
│   ├── cli/               # @sensigo/realm-cli (binary: realm)
│   ├── mcp-server/        # @sensigo/realm-mcp
│   ├── testing/           # @sensigo/realm-testing
│   └── cloud/             # hosted app (later)
│       ├── api/
│       ├── web/           # Next.js dashboard
│       └── workers/
├── workflows/             # example workflow definitions
│   ├── extract-and-update/
│   └── invoice-extraction/
├── schemas/               # example domain schemas
├── docs/
│   ├── protocol.md
│   ├── getting-started.md
│   └── building-components.md
└── package.json           # workspace root
```

### Phased plan (10-15 hrs/week) — REVISED

This plan was revised after the full architecture was designed. The original plan (4 weeks to core engine) assumed a simpler engine without dual guards, structured errors, concurrency control, run lifecycle, human gates, auto-execution, or testing foundations. The revised plan accounts for all of these while maintaining the principle that every phase produces something you can run and test.

**Phase 1a (weeks 1-3): Minimum viable engine — can run a linear workflow end-to-end**

Goal: define a workflow in YAML, register it, start a run via CLI, execute steps, see results.

Week 1 — Foundation:
- Project scaffold (monorepo with turborepo, TypeScript config)
- `RunRecord` type with lifecycle fields and version counter
- `JsonFileStore` with atomic versioned writes (file lock + version check)
- `ResponseEnvelope` type with structured next_action
- Positional state guard (fast path, no preconditions yet)
- Basic execution loop: load run → check guard → execute → update state → return envelope
- `WorkflowError` class with error codes and categories (six categories, agent_action field)
- `realm validate` CLI command (static YAML validation)

Week 2 — Step execution and evidence:
- Step dispatcher (routes commands to step implementations)
- Evidence snapshot capture (inputs, outputs, timestamps per step)
- Three extension interfaces defined (ServiceAdapter, Processor, StepHandler)
- Mock-able adapter interface (MockAdapter wrapper) — testing foundation
- Agent response injection in test mode — testing foundation
- Generic HTTP adapter (engine_managed — HTTP calls with stored credentials)
- Input schema validation (JSON Schema check before step execution)
- Secrets loading from .env file

Week 3 — First working workflow:
- Workflow YAML loader (parse, validate references, store)
- `realm register` CLI command
- `realm run` CLI command (interactive — execute steps from terminal)
- Processing pipeline (run processors in order, compute hash)
- Built-in processors: normalize_text, compute_hash
- Port simplified clozr extraction workflow as first example (3-4 steps)
- First end-to-end test: register, start run, execute steps, see evidence

Deliverable: `npm install @sensigo/realm`, define a workflow in YAML, run step by step from CLI. Evidence chain captured. Errors structured. Store has versioned writes.

**Phase 1b (weeks 4-5): Reliability and human gates — handles real-world conditions**

Goal: the engine handles failures, supports human gates, and has auto-execution.

Week 4 — Reliability:
- Step timeouts with configurable policies (abandon, warn_and_wait)
- Step-level retry with exponential backoff
- Pending states for long-running operations (concurrency protection)
- Run lifecycle transitions (active → terminal states)
- Run resume from failed step (`realm resume` CLI command)
- Stale run detection and cleanup (`realm cleanup` CLI command)

Week 5 — Human gates and auto-execution:
- Human gate mechanics (confirm_required state, gate_id, preview data)
- `submit_human_response` in CLI (simulates MCP tool locally)
- Auto-execution mode (engine chains auto steps internally)
- Precondition guard (expression evaluator, auto-resolution)
- Trust levels enforcement (auto, human_notified, human_confirmed, human_reviewed)
- Review challenge for human_reviewed gates

Deliverable: engine handles timeouts, retries, human gates, auto-execution. A 12-step workflow with 9 auto steps runs internally, returning to caller only at 3 agent steps.

**Phase 2 (weeks 6-8): MCP server, CLI polish, and testing**

Goal: AI agent can connect via MCP and drive a workflow. Developer has full testing tools.

Week 6 — MCP server:
- MCP server wrapping the engine (six tools: list_workflows, get_workflow_protocol, start_run, execute_step, submit_human_response, get_run_state)
- Protocol generation from workflow YAML (rules, step descriptions, input schemas)
- Skill file template generation

Week 7 — CLI polish and diagnostics:
- `realm inspect` (view run evidence chain, step-by-step)
- `realm replay` (re-evaluate stored evidence with modified parameters)
- `realm diff` (compare two replays)
- Per-step diagnostics payload (trace, anomalies)
- `realm init` (scaffold a new workflow project)

Week 8 — Testing:
- Testing package (`realm/testing`)
- `testStepHandler`, `testProcessor`, `testAdapter` utilities
- `realm test` with fixtures (integration testing with mock services)
- Test mode flag in run records

Deliverable: AI agent in VS Code or Claude connects to MCP server, discovers workflows, drives them step-by-step with next_action guidance. Developer inspects runs, replays with modified parameters, runs integration tests with fixtures.

**Phase 3 (weeks 9-11): Second workflow, branching, and templates**

Goal: prove the platform is general. Add features the second workflow needs.

Week 9-10 — Second workflow:
- Pick different domain (invoice extraction, contract review, support ticket categorization)
- Build on the platform — identify abstraction gaps
- Add missing built-in processors or adapters
- Conditional branching in the flow graph

Week 11 — Step templates:
- Template YAML format with parameters
- Template resolver (parameter substitution, override merging, prefix handling)
- Extract common steps from two workflows into shared templates
- `realm validate` updated to validate templates

Deliverable: two working workflows in different domains on the same engine. Shared step templates. Conditional branching.

**Phase 4 (weeks 12-13): Public launch**

Week 12 — Documentation and examples:
- Getting-started guide (npm install to running first workflow)
- Building-extensions guide (adapters, processors, step handlers)
- Protocol spec (how the engine works, for contributors)
- Two complete example workflows with test fixtures

Week 13 — Launch:
- Blog post: "How I made AI agents follow a 12-step process without going off-script"
- GitHub repo public, npm publish 1.0
- Hacker News, Reddit, Discord posts

Deliverable: public open source project with docs, examples, launch post.

**Phase 5 (weeks 14-20): Cloud app — only if Phase 4 shows signal**

Week 14-15 — Cloud API:
- Postgres store implementation (same RunStore interface as JsonFileStore)
- HTTP API wrapping the engine (same routes as MCP tools, REST)
- Auth (API keys per user)
- Deploy to Railway or Fly.io

Week 16-17 — Dashboard:
- Next.js app with run list, run inspector, evidence viewer
- Workflow registration via upload
- Log querying

Week 18-19 — Cloud-only features:
- Cross-run analytics (field performance, error patterns)
- Workflow version management
- Scheduled workflows (cron triggers)

Week 20 — Billing:
- Stripe integration, $49/month plan, usage metering

**Phase 6 (weeks 21+): Growth features — driven by user demand**

- AI-powered workflow diagnostics (cloud AI assistant)
- Parallel step execution
- Workflow composition (sub-workflows)
- Webhook processors (custom code on developer's server)
- Chunked document delivery for large documents
- Document collection indexing and RAG search
- Plugin marketplace
- Team collaboration and role-based access
- Sandboxed code execution in cloud
- Domain schema packs and project bundles

### Critical path

Weeks 1-3 (Phase 1a) are the highest risk. The core engine architecture — store interface, execution loop, evidence capture, extension interfaces — must be right because everything else builds on it. These weeks need the most care and least rushing.

Week 6 (MCP server) is when the product becomes real — an AI agent can actually use it. Everything before is infrastructure. Everything after is polish and features.

Week 13 (launch) is the demand validation moment. If the blog post and repo don't get traction, you learn that before investing in cloud infrastructure.

### Comparison with original plan

| Aspect | Original plan | Revised plan |
|--------|--------------|--------------|
| Phase 1 scope | ResponseEnvelope, state guards, store, evidence, adapters, YAML | All of original + dual guards, structured errors, concurrency, run lifecycle, human gates, auto-execution, testing foundations |
| Phase 1 duration | 4 weeks | 5 weeks (split into 1a + 1b) |
| Phase 2 scope | CLI + MCP server + diagnostics | CLI + MCP server + diagnostics + testing package |
| Phase 2 duration | 3 weeks | 3 weeks |
| Phase 3 scope | Second workflow | Second workflow + branching + step templates |
| Phase 3 duration | 2 weeks | 3 weeks |
| Public launch | Week 10 | Week 13 |
| Cloud ready | Week 16 | Week 20 |
| Total to launch | 10 weeks | 13 weeks |
| Total to revenue | 16 weeks | 20 weeks |

The revised plan is 3 weeks longer to launch and 4 weeks longer to revenue. The trade-off: every reliability feature (timeouts, retries, concurrency, human gates, structured errors) is in from the start instead of being retrofitted later. The engine is production-grade from Phase 1b, not just a demo.

### Feature-to-phase mapping

| Feature | Phase | Week |
|---------|-------|------|
| ResponseEnvelope + structured next_action | 1a | 1 |
| JsonFileStore with versioned writes | 1a | 1 |
| Positional state guard | 1a | 1 |
| WorkflowError with error taxonomy | 1a | 1 |
| `realm validate` | 1a | 1 |
| Extension interfaces (ServiceAdapter, Processor, StepHandler) | 1a | 2 |
| Mock-able adapter interface | 1a | 2 |
| Evidence snapshots | 1a | 2 |
| Input schema validation | 1a | 2 |
| Generic HTTP adapter | 1a | 2 |
| Workflow YAML loader + `realm register` | 1a | 3 |
| `realm run` (CLI) | 1a | 3 |
| Processing pipeline + built-in processors | 1a | 3 |
| First working workflow | 1a | 3 |
| Step timeouts | 1b | 4 |
| Step-level retry | 1b | 4 |
| Pending states (concurrency) | 1b | 4 |
| Run lifecycle + terminal states | 1b | 4 |
| Run resume | 1b | 4 |
| Human gates + submit_human_response | 1b | 5 |
| Auto-execution mode | 1b | 5 |
| Precondition guard + expression evaluator | 1b | 5 |
| Trust levels | 1b | 5 |
| MCP server (6 tools) | 2 | 6 |
| Protocol generation | 2 | 6 |
| `realm inspect` + `realm replay` + `realm diff` | 2 | 7 |
| Diagnostics (trace, anomalies) | 2 | 7 |
| `realm init` | 2 | 7 |
| Testing package + `realm test` | 2 | 8 |
| Second workflow | 3 | 9-10 |
| Conditional branching | 3 | 10 |
| Step templates | 3 | 11 |
| Documentation | 4 | 12 |
| Public launch | 4 | 13 |
| Postgres store + cloud API | 5 | 14-15 |
| Dashboard | 5 | 16-17 |
| Cross-run analytics + versioning + scheduling | 5 | 18-19 |
| Billing | 5 | 20 |
| Parallel execution, sub-workflows, RAG, plugins | 6 | 21+ |

### Open source strategy

**Open source:** The core engine (npm package), CLI, MCP server, built-in processors, example workflows. This is the protocol — what developers evaluate, trust, and build on.

**Proprietary (paid):** The hosted cloud service — managed sessions, web dashboard, audit log explorer, workflow editor UI, team collaboration, aggregate analytics across runs, AI-assisted workflow creation via chat.

**Pricing model:**
- Free: self-hosted (open source)
- $49/month: managed cloud (sessions, dashboard, diagnostics)
- Custom: enterprise (SSO, compliance export, SLA)

---

## Part 10: The Original Agent Proposal

Before the architectural exploration in this document, the developer had a conversation with an AI agent (Claude Sonnet 4.6) about productizing the clozr session manager. This section captures that full proposal and the subsequent critique, since many of its ideas influenced the final architecture.

### What the agent proposed

**Core insight (correct):** The session manager solves a specific problem — LLMs don't have reliable working memory across turns, but they're excellent at following single-step instructions. So instead of trusting the LLM to "remember where we are," the state machine does it and tells the LLM exactly what to do next via `next_action`. The LLM becomes stateless — it just executes one instruction at a time and the machine owns state. The agent called this "process orchestration with LLM-as-executor."

**Proposed form:** A hosted HTTP REST API, not an MCP server. Three routes:
- `POST /sessions` — create a session from a workflow definition
- `POST /sessions/{id}/step` — submit a command, get back `{status, data, next_action}`
- `GET /sessions/{id}` — inspect session state and audit log

**Language recommendation: TypeScript.** Reasoning: primary consumers are AI agents in VS Code, Cursor, Claude Desktop, Windsurf — all TypeScript-native. MCP SDK is TypeScript-first. Python is right for ML/data pipelines but wrong for a developer-facing API service.

**Infrastructure recommendation: Cloudflare Workers + Durable Objects.** Reasoning: Durable Objects give per-session strong consistency as isolated stateful actors. No database needed for the state machine itself. Globally distributed with near-zero cold start. $5/month tier covers serious usage. Sessions in Durable Objects for hot state, R2 or D1 for audit log and completed session history.

**Pricing recommendation:** Don't open source. Price it as SaaS:
- Free tier: 1 workflow, 100 sessions/month, community workflows only
- Builder: $29/month — unlimited custom workflows, 10k sessions/month, private workflows
- Team: $99/month — team workflow sharing, audit log export, priority support

The agent specifically argued against $5/month ("will attract cost-sensitive users who churn") and for $29 ("attracts developers who actually ship things").

**Configurability model — three layers:**

Layer 1 — Predefined steps (atomic building blocks): `confirm_gate`, `http_write`, `validate_schema`, `fetch_url`. Reusable across workflows.

Layer 2 — Predefined workflows (ready to use): `field-update`, `send-notification`, `extract-from-doc`, `approval-chain`.

Layer 3 — Custom workflows (user-defined, declarative YAML/JSON): users wire together steps into custom flows with state transitions and step configurations.

**Context delivery problem:** The agent identified this as the hardest unsolved problem. In the current system, `build_extraction_input` returns a 34K document in the response and the `next_action` says "the document is above." This works because everything is in the LLM's context window. In a cloud service, context can scroll out of attention between turns. The agent proposed five mechanisms:
- `context_inject` — declare which keys to pull from session store per step
- `context_url` — serve large fields via URL instead of inline
- `context_handle` — short reference to server-side stored content
- `context_summary` — brief description of what's stored without the full content
- `context_reminder` — note saying "this was delivered in step X"

**Timeline estimate:** 9–12 working days across three phases:
- Phase 1 (3–4 days): Working core — Hono + Durable Objects + TypeScript, session actor, response envelope, 3 predefined steps, field-update workflow, HTTP API, context assembly
- Phase 2 (2–3 days): Custom workflows + second workflow — YAML parser, workflow registry, auth, session history
- Phase 3 (4–5 days): Dashboard + billing — Next.js + Clerk + Stripe, session inspector, workflow editor, usage metering

### Critique of the original proposal

**What the agent got right:**
- The core insight about LLM-as-stateless-executor is genuinely sharp and worth building a product around
- The `next_action` field as the killer feature — this is what makes the pattern work
- The pricing advice ($29 not $5) is textbook correct for developer tools
- Identifying context delivery as the hardest problem

**What the agent got wrong:**

1. **Wrong abstraction boundary.** The agent proposed generalizing the state machine. But the state machine is trivial — `_ALLOWED_STATES` is a dict, the guards are 5-line functions. The real value is the composition of state guards + context assembly + domain validation. The agent was generalizing the wrong layer.

2. **The step contract is the real primitive, not the session.** The `ResponseEnvelope` — `{status, data, next_action, errors, warnings}` — is the most important thing in the codebase. The session is just a bag that holds accumulating context. The product should be architected around the step contract.

3. **Premature infrastructure.** Cloudflare Durable Objects are architecturally sound but add 3–5 days of learning curve for zero user-facing benefit. A Postgres table with a JSONB state column does the same job. Start simple, migrate when you have 1,000 concurrent sessions.

4. **Over-complex context delivery.** Five different context mechanisms is too many. In practice there are only two patterns: small structured context (always inline, under 2KB) and one large document per session (delivered once, referenced by hash). One mechanism, not five.

5. **YAML can't express real business logic.** The agent proposed YAML workflow definitions, but the actual validation code has 80+ lines of regex matching, fuzzy scoring, and deduplication. YAML works for the flow graph (which states connect to which) but step implementations are always code.

6. **No demand validation.** The entire proposal assumes the product should exist and jumps to architecture and pricing. Before building, you need to know: who are the first five paying users? What workflow are they running today? The product risk dwarfs the technical risk.

7. **Timeline is optimistic.** 9–12 days assumes no design pivots and prior Durable Objects experience. More realistic with unfamiliar infrastructure: double it.

---

## Part 11: Decision Log

This section records the major decisions made during the architectural exploration and the reasoning behind each one.

### Decision: TypeScript over Python for the platform

**Context:** The developer is equally comfortable with both languages. The existing clozr app is Python.

**Decision:** TypeScript for the platform. Python clozr code stays as-is and becomes the first workflow implementation.

**Reasoning:** The primary consumers are AI agents in TypeScript-native ecosystems (VS Code, Claude, Cursor, Windsurf). The npm package is the distribution channel. MCP SDK is TypeScript-first. One language end-to-end means one build system and one set of dependencies. The Python CLI doesn't need to be rewritten — it becomes a workflow that runs on the platform.

### Decision: Open source the core, proprietary cloud service

**Context:** The original agent recommended keeping everything proprietary. The developer was initially concerned about competitors.

**Decision:** Open source the runtime, CLI, MCP server, built-in processors, and example workflows. Keep the hosted cloud service proprietary.

**Reasoning:**

The argument for open source:
- Trust protocols need to be inspectable. If the product promises "we verify the AI's work," that promise is only credible if users can read the verification code.
- The Terraform/Redis/Elasticsearch model works: open source core gets adoption, cloud service gets revenue.
- Open sourcing the core is a flex, not a giveaway. The implementation is too nuanced to clone and beat — verbatim quote matching with normalized whitespace, fuzzy fallback, section-aware rejection, confidence deduplication.
- Distribution: developers adopt the open source version, build on it, and pay for the hosted version when they need reliability, team features, or don't want to self-host.

The argument against (from the original agent):
- Enterprise users self-host and you get nothing.
- Time spent on GitHub issues instead of building.

Counter-argument: Enterprise users who self-host a free tool and then need audit logs, team collaboration, and SLA guarantees become enterprise customers. GitHub issues are demand signals, not distractions.

### Decision: Start with Postgres, not Durable Objects

**Context:** The original agent proposed Cloudflare Durable Objects for per-session strong consistency.

**Decision:** Start with Postgres (Neon or Supabase free tier) on Railway or Fly.io.

**Reasoning:** The current Python app uses JSON files on disk and it works. Postgres with a JSONB state column is the cloud equivalent — simple, well-understood, zero learning curve. Durable Objects are the right choice at scale (per-session isolation, zero cold start) but add 3–5 days of learning curve for zero user-facing benefit at launch. Migrate to Durable Objects when there are 1,000 concurrent sessions, which is a good problem to have.

### Decision: Engine fetches source documents, not the agent

**Context:** Early design explored a "resource reference" model where the agent fetches resources and the engine just stores references.

**Decision:** For source documents (content that validation depends on), the engine fetches directly, normalizes to a canonical format, computes the hash, stores the authoritative copy, and delivers the content to the agent in the step response.

**Reasoning:**
- If the agent fetches the document, the engine can't guarantee the agent is working from the correct content. The agent might use a cached version, truncate it, or fetch it in a different format.
- Format matters: plain text vs markdown produces different cue matches, different whitespace, different verbatim quotes. If the engine and agent work from different formats, validation breaks.
- The engine delivering the content ensures the agent and the engine's validation layer work from the exact same text. The hash verification (agent reports hash, engine compares) provides an additional check.
- This is exactly what the current Python app already does — `build_extraction_input` delivers `document_text` in the response and the `next_action` says "the document is above."

### Decision: Three resource trust levels

**Context:** Different resources have different security and integrity requirements.

**Decision:** Three trust levels: `engine_delivered`, `agent_fetched`, `engine_managed`.

**Reasoning:**
- Source documents need `engine_delivered` — the engine must control the format, normalization, and hash for validation integrity.
- Schemas and config files can be `agent_fetched` — if the agent misreads them, downstream validation catches the errors. Lower stakes, simpler implementation.
- APIs with credentials need `engine_managed` — the agent should never see API keys. The engine acts as a proxy: the agent says what it wants to write, the engine validates and executes the API call, recording the full request/response in the evidence chain.

### Decision: Processing pipelines for resource transformation

**Context:** Documents often need conversion (PDF to markdown), normalization (smart quotes), and custom processing (redacting PII) before they reach the agent.

**Decision:** Inbound and outbound processing pipelines declared in the workflow YAML. Built-in processors for common operations. Custom processor hooks for user-specific logic.

**Reasoning:**
- The current Python app already does post-processing (smart quote normalization, dash normalization). This just makes it explicit and configurable.
- Pipelines are ordered — each processor receives the previous one's output. `compute_hash` always runs last so the hash reflects the final content.
- Every processor's execution is recorded in the evidence snapshot (input size, output size, what changed, duration). This means when debugging a failed extraction, you can see whether the PDF conversion dropped a table or normalization mangled a cue string.
- Custom hooks let developers add domain-specific processing (PII redaction, section filtering, OCR) without modifying the core engine.

### Decision: Skill file as bootstrap, protocol from MCP server

**Context:** In the current system, the skill file (SKILL.md) contains the full workflow instructions — all 12 steps, every rule, every edge case. This makes it long, hard to maintain, and requires updating on every user's machine when the workflow changes.

**Decision:** The skill file becomes a short bootstrap that tells the agent where the MCP server is and how to start. The full workflow protocol (rules, step descriptions, error handling) is served dynamically by the MCP server via `get_workflow_protocol`.

**Reasoning:**
- Updating workflows no longer requires touching files on user machines.
- The protocol is always the latest version — the agent gets it fresh on every connection.
- Skill files stay simple and easy for agents to follow (addressing the problem that agents can't handle complex skill files).
- The workflow author writes the protocol once in the workflow definition. The MCP server serves it to any agent that connects.

### Decision: Validate demand before building cloud infrastructure

**Context:** The developer has 10–15 hours per week. Building a full cloud app with dashboard and billing takes 6+ weeks.

**Decision:** Ship the open source core (npm package + CLI + MCP server) first. Only build the cloud app after seeing signal — GitHub stars, npm installs, people asking for a hosted version.

**Reasoning:**
- Building infrastructure without demand validation is the most common way technical founders waste months.
- The open source release tests demand with minimal investment. If the blog post and repo get traction, there's a market. If they don't, you learn that before investing in Stripe integration.
- Every phase of the build plan produces something usable and showable — no phase requires the next phase to be valuable.

### Decision: Custom processors in cloud — phased approach

**Context:** The local npm package allows developers to register custom processors as code. In the cloud version, we can't execute arbitrary user-uploaded code on our servers — security risks include reading other users' data, unauthorized network calls, resource abuse, and server crashes.

**Decision:** Four approaches evaluated, to be implemented in phases:

1. **Launch:** Built-in processors only in cloud. Custom processing available only via the local npm package. Zero security risk, zero infrastructure cost.
2. **First cloud upgrade:** Webhook processors — developers host custom processors on their own servers, engine calls them via HTTPS during the pipeline. No untrusted code on our servers, developer has full flexibility on their own infrastructure.
3. **Scale phase:** Sandboxed execution — developers upload code, engine runs it in V8 isolates with restrictions (no network, no filesystem, memory/time limits).
4. **Ecosystem phase:** Processor marketplace — community-published processors with review and auditing.

**Reasoning:**
- Starting with built-in only is the safest path. The most-requested custom processors from users become the next built-in ones — this is a product signal, not a limitation.
- Webhooks are the sweet spot for the first upgrade: architecturally clean (we never run untrusted code), small engineering effort (just an HTTP POST in the pipeline), and full flexibility for the developer. The trade-offs (latency, developer must host an endpoint) are acceptable for the use cases that need custom processing.
- Sandboxed execution is the right eventual answer but adds weeks of infrastructure work. Only justified when there are enough cloud users to warrant it.
- The marketplace is a full ecosystem play that only makes sense at scale.

**Security measures for the webhook approach:**
- HTTPS only — reject HTTP webhook URLs
- Request signing — engine signs requests with a shared secret so the developer's server can verify the caller (similar to Stripe webhook signatures)
- Workflow-level restrictions — developer can restrict which workflows call their webhook
- Evidence chain logging — every webhook call recorded with URL, bytes sent/received, duration
- Explicit data acknowledgment — `data_leaves_platform: true` flag required in workflow definition, shown prominently in dashboard and run logs, displayed as a warning during workflow registration

### Decision: Large document handling — three-scenario model

**Context:** The current clozr workflow handles a 34K character document that fits in one context window. The platform needs to handle 200-page contracts, document collections, and large knowledge bases that exceed context window limits.

**Decision:** Three scenarios handled by three different delivery strategies, implemented in phases:

1. **Chunked single document:** Engine splits large documents into section-aware chunks, delivers them one at a time, deduplicates candidates across chunks, validates quotes against the correct chunk. The engine manages all chunking — the agent never decides how to split.
2. **Document collection:** Engine indexes all documents (title, sections, key phrases), serves the index to the agent, agent requests specific documents by ID. Engine acts as librarian.
3. **RAG-integrated search:** Engine builds a vector index (embeddings), agent searches by query, engine returns top-k relevant passages with source tracking. Candidates include doc_id and chunk_id for audit verification.

**Reasoning:**
- Section-aware splitting (not arbitrary character splits) is essential because verbatim quote validation fails if quotes span chunk boundaries. Slight overlap at boundaries catches edge cases.
- The engine must manage chunking and search, not the agent. This keeps the engine as the single authority on document content — critical for the audit trail and hash verification.
- RAG integrated into the workflow engine (rather than as a separate system) enables auditable retrieval — every search query, every result, every relevance score is recorded in the evidence chain. This is the "auditable RAG" differentiator: not just "the AI found something" but a traceable path from query to passage to extracted value to verified quote.
- The auto-delivery mode (inline if small, chunked if large) means workflow authors don't need to know document size in advance — the engine adapts at runtime.

**Implementation timeline:**
- Scenario 1 (chunked single document): Phase 2-3, 2-3 days. Must be ready for launch because users will try large documents.
- Scenario 2 (document collections): Phase 3-4, 3-4 days. Needed when workflows involve multiple source documents.
- Scenario 3 (RAG with vector search): Phase 5+, 1-2 weeks. Requires embedding model integration or external vector database adapter. Only when demand justifies it.

### Decision: No LangChain or similar frameworks

**Context:** LangChain, LangGraph, and similar frameworks provide abstractions for LLM-powered applications — document loaders, text splitters, vector store integrations, embedding wrappers, retrieval chains, and agent orchestration. The question was whether to use any of these as a foundation or component library instead of building document handling, chunking, and search from scratch.

**Decision:** No. Write the core operations directly in TypeScript with minimal dependencies. Do not use LangChain, LangGraph, Temporal, Inngest, or any LLM orchestration framework.

**Reasoning — three core arguments:**

1. **Philosophical mismatch.** LangChain and LangGraph are built around the idea that the LLM is the decision-maker. A LangChain "agent" decides which tools to call, in what order, with what parameters. This product exists because that approach is unreliable. The core insight is: don't let the LLM decide what's next — the state machine decides, the LLM executes. Building a deterministic, engine-driven workflow system on top of a framework designed for LLM-driven orchestration means fighting the framework's assumptions at every step.

2. **Thick abstraction over simple operations.** The engine's document handling pipeline in total is roughly 125 lines of straightforward TypeScript:
   - Fetch a URL: one `fetch()` call, ~10 lines with error handling
   - Convert PDF to markdown: one library call (`pdf-parse` or `mammoth`), ~20 lines
   - Split into section-aware chunks: find headings, split there, ~50 lines
   - Compute embeddings: one POST to OpenAI's embedding API, ~15 lines
   - Search a vector index: cosine similarity or one pgvector query, ~30 lines

   LangChain would replace these 125 lines with a `DocumentLoader`, `TextSplitter`, `Embeddings`, `VectorStore`, `Retriever`, and `RetrievalChain` class — each with its own configuration, abstraction layer, interface quirks, and dependency tree. Fewer lines of our code, but thousands of lines of someone else's code that we don't control, don't fully understand, and that changes with every LangChain release.

   For a product where the audit trail depends on knowing exactly what happened to a document at every stage, a thick abstraction between the engine and the actual operations is a liability.

3. **Dependency risk.** LangChain is a fast-moving project with frequent breaking changes. If the workflow engine depends on LangChain for document loading, chunking, and vector search, then every LangChain update is a potential regression in the core pipeline. Users' workflows could break because LangChain changed how their text splitter handles whitespace, renamed a class, or deprecated an integration. For a product that promises reliability and auditability, the core pipeline should have minimal external dependencies.

**What about using LangChain piecemeal (just the document loaders, just the text splitter)?**

Also rejected:
- LangChain's document loaders are thin wrappers around other libraries (PDF loader wraps `pdf-parse`, web loader wraps `cheerio`). Use the underlying libraries directly — less overhead, more control.
- LangChain's text splitters are generic (split by character count, token count, or recursive patterns). The platform needs section-aware splitting that understands heading structure. A custom splitter would be needed anyway.
- LangChain's vector store integrations are useful for supporting multiple databases, but at launch the platform needs exactly one (in-memory for local, pgvector for cloud). One integration doesn't justify a framework.

**What about LangGraph specifically?**

LangGraph is closer to what we're building — step-by-step flows with state. But the same fundamental problem applies: LangGraph is designed for LLM-driven flow control where the LLM decides which node to visit next. This system doesn't let the LLM decide — the engine decides via `next_action`. LangGraph also has no concept of evidence chains, trust levels, hash verification, or audit trails. The workflow runner that LangGraph replaces is maybe 40 lines of code (check state guard, call step function, update state). Not worth a framework dependency.

**What about Temporal and Inngest?**

Temporal is a workflow orchestration engine — good at retries, timeouts, long-running workflows. But it's infrastructure-heavy (requires a Temporal server), designed for microservice orchestration rather than LLM-agent interaction, and has no concept of evidence chains or agent guidance. Overkill.

Inngest is an event-driven background job system. Simpler than Temporal but no concept of LLM guidance, evidence tracking, or human gates. Would only serve as a job runner with everything else built on top.

Both are wrong-shaped for this product.

**The guiding principle:** The engine's core operations are each individually simple (20-50 lines of TypeScript). The product's value is in how these operations are composed with evidence tracking, trust levels, and agent guidance — none of which any existing framework provides. Write the simple parts yourself, keep full control, and keep the dependency tree small.

### Decision: Structured next_action with auto-execution mode

**Context:** In the current design, `next_action` is a plain English string. The agent reads it and (hopefully) follows it. The engine has no way to verify the agent followed the instruction, and every step requires a round-trip through the agent even when the agent does no real work — it just relays the command.

**Decision:** Make `next_action` a structured object with both machine-readable instruction and human-readable explanation. Add auto-execution mode where the engine executes steps internally when the agent isn't needed.

**Reasoning:**
- A structured `instruction` field can be directly mapped to an MCP tool call, enabling programmatic verification and auto-execution.
- In the clozr workflow, 9 of 12 steps are engine-side work (validate target, fetch document, run prechecks, validate candidates, persist update). The agent is just a relay. Auto mode eliminates these unnecessary round-trips.
- Fewer round-trips = faster workflow execution and fewer opportunities for the agent to call the wrong step.
- The `human_readable` field preserves the agent-facing guidance for steps that require agent involvement.
- The `context_hint` helps agents reason about why a step is next, reducing confused behavior.
- Must be designed into the engine from day one — retrofitting structured next_action onto a string-based system is painful.

### Decision: Step timeouts, retries, and run resume as core engine features

**Context:** The current Python app has a crude 24-hour stale run cleanup. There's no retry for transient failures and no way to resume a run from a failed step — the only option is starting over.

**Decision:** Build step-level timeouts, configurable retry policies, and run resume into the engine core from Phase 1.

**Reasoning:**
- Timeouts: without them, runs hang forever when the agent crashes, the user closes the chat, or the agent gets distracted. Each step declares its own timeout based on expected duration (30s for simple operations, 24h for human gates).
- Retries: transient failures (network errors, API rate limits, HTTP 500s) are common when calling external services. The engine should retry internally with exponential backoff, not surface the error to the agent. The agent should only see final success or permanent failure.
- Resume: when a step fails permanently (wrong URL, auth failure), the developer should fix the problem and resume from the failed step — not re-run all previous steps that already succeeded. This preserves the evidence from successful steps and avoids redundant work.
- All three are fundamental reliability features, not nice-to-haves. Any workflow running against real external services will encounter timeouts, transient failures, and fixable errors. Without these, every such incident requires starting from scratch.

### Decision: Input schema validation per step

**Context:** The engine currently trusts whatever params the agent sends to `execute_step`. Malformed input causes confusing errors deep in step logic.

**Decision:** Each step declares a JSON Schema for its expected input. The engine validates before executing.

**Reasoning:**
- Early, clear error messages ("candidates must be an array") instead of cryptic failures inside step logic.
- The schema doubles as documentation — agents can call `describe_step` to see what inputs are expected, with types and examples.
- JSON Schema is a well-established standard with TypeScript libraries (ajv) that validate in microseconds.
- Low implementation cost, high reliability benefit. Should be in Phase 1.

### Decision: Conditional branching and parallel execution as Phase 2-3 features

**Context:** The current workflow model is linear (step 1 → step 2 → step 3). Real workflows have branching (success vs failure paths, user confirms vs cancels) and independent steps that could run in parallel.

**Decision:** Add explicit conditional branching in Phase 2, parallel step execution in Phase 3+.

**Reasoning:**
- Branching: even simple workflows have success/failure/cancel paths. The clozr workflow already has implicit branching (identity verification success vs human gate, user confirm vs cancel). Making this explicit in the workflow definition lets the engine validate the flow graph at registration time and show which branch was taken in diagnostics.
- Parallel execution: independent steps (validate target + fetch document) running simultaneously saves time. Most impactful for the cloud version with scheduled workflows running hundreds of times. Limited to auto-execution steps to avoid requiring agents to handle concurrent instructions.
- Both are important but not Phase 1 critical — a linear workflow model works for launch. Branching is Phase 2 because it's needed almost immediately. Parallel execution is Phase 3+ because it's a performance optimization, not a correctness requirement.

### Decision: Workflow composition as a Phase 4+ feature

**Context:** Complex processes involve multiple workflows — onboard a client (extract playbook + create CRM record + send welcome email), each of which could be its own tested, versioned workflow.

**Decision:** Support sub-workflows (calling one workflow as a step in another) in Phase 4+.

**Reasoning:**
- Sub-workflows get their own run record (own evidence chain, own state machine) but the parent tracks them as a single step. This keeps each component independently debuggable and independently versioned.
- Enables building complex multi-stage processes from smaller, tested components — exactly the composability that makes a platform, not just a tool.
- High implementation complexity (nested state management, nested human gates, nested evidence chains). Not needed for launch or early adoption. Becomes important when users build multiple workflows and want to combine them.
- Design consideration: the parent's evidence chain includes a reference to the sub-workflow run (run_id, status, output summary) but not the full sub-workflow evidence. This prevents run records from growing unbounded in deeply nested scenarios.

### Decision: Three extension interfaces instead of a unified component abstraction

**Context:** Early models (Model 1 and Model 2) proposed a unified `VerifiedComponent` interface that all custom code would implement. This forced developers into a formal abstraction with evidence specs, trust declarations, and typed schemas — even for simple operations.

**Decision:** Replace the unified component with three minimal, purpose-specific interfaces: `ServiceAdapter` (external API communication), `Processor` (content transformation), and `StepHandler` (custom step business logic). Collectively called "extensions."

**Reasoning:**
- These are three genuinely different things, not one thing with three flavors. An adapter connects to an API with auth quirks. A processor transforms text in a pipeline. A step handler runs business logic. Forcing them into one interface makes the interface vague and unhelpful.
- Each interface is one method plus an ID. The barrier to writing an extension is writing one function. The engine wraps every call with evidence capture, input validation, timeout, and retry — the developer's code just does the work.
- The collective term "extensions" is generic and unpretentious. "Write an extension" is less intimidating than "implement a VerifiedComponent." When someone asks "how do I extend the engine?" the answer is concrete: "write an adapter for a new service, a processor for content transformation, or a step handler for custom logic."
- The engine handles all cross-cutting concerns (evidence, validation, timeout, retry) automatically around every extension call. This means the formal evidence specs and trust declarations from Model 1's `VerifiedComponent` are still present — they're just provided by the engine, not declared by the developer.

### Decision: Dual-guard model (positional states + preconditions)

**Context:** The final architecture initially used only positional state guards (`allowed_from_states`). These are fast and simple but produce unhelpful error messages ("command not allowed in state X") and can't verify that prerequisites were actually accomplished — only that the state string is correct. Model 1's precondition-based guards were semantically richer but added implementation complexity. The question was whether to accept the trade-off or find a middle ground.

**Decision:** Use both layers together. Positional state guards as the fast path (checked first, O(1) set lookup, handles 95% of cases). Precondition guards as the semantic path (checked when the positional guard fails, evaluates expressions against the actual run record, provides precise error messages and auto-resolution).

**Reasoning:**
- For AI agents specifically, precise error messages are critical. An agent that gets "blocked in state X" has to reason about state transitions to figure out what to do. An agent that gets "target_validation is missing — call validate_target" has a direct instruction to follow.
- Auto-resolution combined with auto-execution mode is a major performance feature. If a step's preconditions aren't met but the missing prerequisites are auto-execution steps, the engine runs them internally. The agent asks for one step and gets three — in one round-trip. This is only possible with preconditions that name specific resolution steps.
- Preconditions are essential for complex workflows with parallel steps. When two parallel branches must complete before a step can run, a positional state (which can only be one value) can't express this. Preconditions check multiple independent facts against the run record.
- Preconditions handle resume scenarios correctly. After a failure and resume, the positional state might be stale. Preconditions check actual run record data — if `target_validation` actually ran and its result is in the run record, the precondition passes regardless of the state string.
- The expression language is deliberately simple (path lookups + comparisons, ~100-150 lines of TypeScript). No variables, no functions, no loops. Complex conditions are handled by step implementations returning different status values, not by complex precondition expressions.
- Preconditions are optional. Simple linear workflows use only `allowed_from_states` with zero overhead. Preconditions are added only when needed (parallel steps, resume scenarios, auto-resolution). This is progressive disclosure applied to the guard model.

### Decision: Five-level testing model with Phase 1 foundations

**Context:** The original design had no testing story. A developer building a workflow had no way to verify it worked before running against real data and real APIs. The CLI had `realm replay` for re-evaluating stored evidence, but there was no concept of mock data, test fixtures, or dry-run mode.

**Decision:** Five testing levels, each catching different classes of errors. Three foundational capabilities must be designed into the engine from Phase 1 to enable the full testing stack later.

**The five levels:**
1. `realm validate` — static workflow validation (YAML structure, flow graph, references). Instant. Phase 1.
2. Unit testing — test individual extensions (step handlers, processors, adapters) in isolation with test utilities. Phase 2.
3. `realm test` — integration testing with fixtures and mock services. Full pipeline execution against sample data. Phase 2-3.
4. `realm replay` — replay stored evidence with modified parameters to measure impact of changes. Phase 3.
5. CI/CD — automated testing on every pull request. Phase 4 (launch).

**Phase 1 foundations (must be designed in from the start):**
1. Mock-able service adapter interface — a `MockAdapter` wrapper that intercepts HTTP calls and returns fixture responses. A few lines in the service layer, but retrofitting it later means changing every adapter's wiring.
2. Agent response injection — the step dispatcher checks for pre-built responses in test mode instead of waiting for a real agent. A few lines in the dispatcher.
3. Test mode flag — `test_mode: true` in the run record so test runs are never confused with production runs.

**Reasoning:**
- The key design principle: `realm test` uses the real engine with the real state machine, real evidence capture, real processing pipeline, and real validation logic. Only external service calls and agent responses are mocked. This means tests exercise exactly the same code path as production.
- Mock-able adapters enable both unit testing of adapters (Level 2) and integration testing with fixtures (Level 3). One interface design serves both levels.
- Replay (Level 4) is uniquely valuable for this product. Developers can try dozens of parameter changes in seconds and see the impact of each — no external calls, no agent involvement. Combined with `realm diff`, this enables A/B comparison of schema versions locally, which is the local equivalent of the cloud's version comparison feature.
- CI/CD integration (Level 5) makes testing automatic and prevents merge regressions. Every pull request that modifies a workflow, schema, or extension runs the test suite.

### Decision: Step templates for workflow-level reuse (not a formal component model)

**Context:** The three extension interfaces (ServiceAdapter, Processor, StepHandler) handle code-level reuse. Workflow composition (sub-workflows) handles full-workflow reuse. But there's a gap: reusing a group of steps that always appear together (fetch document → verify identity → extract fields → validate quotes) without the overhead of a separate run record.

**Decision:** Step templates — YAML files that define parameterized groups of steps, included in workflows via an `includes` directive and resolved at registration time. Per-step overrides allow the including workflow to tweak any aspect of any template step. No runtime concept of templates — the engine sees a flat, fully resolved step list.

**Reasoning:**
- Templates fill the reuse gap between single-function extensions and full sub-workflows. They have zero runtime overhead because they're resolved into a flat step list at registration time.
- Per-step overrides with explicit merge semantics (deep merge for config, append/replace for arrays, merge/replace for transitions) let developers customize template behavior for their specific workflow without forking the template.
- Step insertion (redirecting a transition to point to a new step, then continuing to the template's next step) allows workflows to extend template flows without modifying the template itself.
- Prefixes prevent step ID collisions when including multiple templates.
- Templates can be published as plugins alongside domain schemas — install a plugin, include its template, provide your config, and you have a working pipeline. This strengthens the plugin revenue model.
- The `${{ parameters.X }}` syntax (resolved at registration time via string substitution) keeps templates simple — no runtime expression evaluation, no template engine dependency.
- No formal component model. Templates are YAML, not code. A developer who can write a workflow can write a template. The barrier is zero.

**Three reuse mechanisms — complete picture:**
- Extensions: code-level reuse (one function). No overhead.
- Step templates: step-group reuse (multiple steps with config). No runtime overhead (registration-time resolution).
- Workflow composition: full-workflow reuse (independent lifecycle). Runtime overhead (separate run record + evidence chain).

Implementation: Phase 2-3. Once the second workflow is built (Phase 3) and repeated patterns are visible, templates become obviously useful. The engine needs ~100-150 lines for the template resolver (YAML loading, parameter substitution, override merging, prefix application, collision detection).

### Decision: Structured error taxonomy with agent_action field

**Context:** The existing Python app returns errors as plain strings in an array: `errors: ["Bubble write failed: HTTP 503"]`. The agent has to parse English text to decide what to do. The engine's retry logic has no structured way to determine if an error is transient or permanent.

**Decision:** Replace string errors with structured `WorkflowError` objects containing: error code, category, retryable flag, `agent_action` field (what the agent should do), agent-facing message, developer-facing message with details, and step/timing trace. Six error categories (NETWORK, SERVICE, STATE, VALIDATION, ENGINE, RESOURCE) with specific codes per category.

**Reasoning:**
- The `agent_action` field is the most impactful part. Instead of the agent parsing error messages, the engine tells it directly: `report_to_user`, `provide_input` (agent can self-correct), `resolve_precondition`, `stop`, or `wait_for_human`. This enables the agent to handle errors programmatically.
- `provide_input` enables agent self-correction without user involvement. When the agent sends malformed params, the error details tell it exactly what was wrong (field name, expected type, received type). The agent fixes it and retries. Current string errors make this nearly impossible.
- The retryable flag connects directly to the retry logic. The engine checks `retryable` + the step's retry policy to decide whether to retry internally or surface to the agent. The agent only sees errors that have already passed through retry.
- Error codes enable cloud cross-run analytics: "78% of persist_update failures were SERVICE_HTTP_5XX, concentrated between 2-4am UTC."
- Extensions throw `WorkflowError` for intentional errors (recognized and used as-is) or unexpected exceptions (wrapped in ENGINE_*_FAILED with the original error in details). This means extension developers get structured error handling for free.
- Every error and every retry attempt is recorded in the evidence chain, giving the developer complete visibility into what happened and when.

### Decision: Optimistic concurrency with version counter + pending states

**Context:** Multiple agents, browser tabs, or auto-execution chains can attempt to modify the same run record simultaneously. Without concurrency control, state corruption occurs — two operations both pass the state guard, both execute, one overwrites the other's changes.

**Decision:** Two-layer concurrency model: optimistic concurrency via version counter on every write, plus intermediate pending states that block concurrent access through the state guard.

**Reasoning:**
- Version counter is the simplest correct concurrency mechanism. Every write checks "update only if version matches what I read." No distributed locks, no queuing, no coordination protocol. Works identically for JSON files (with a file lock around the read-check-write) and Postgres (WHERE clause on version column).
- Intermediate pending states (`document_fetching`, `persistence_pending`, etc.) handle the common case through the existing state guard — no new mechanism needed. When a step starts slow work, it transitions to `_pending` immediately. Any concurrent call reads the pending state and gets `STATE_BLOCKED`. The state guard, which already exists, does double duty as a concurrency barrier.
- The two layers cover different failure modes. Pending states prevent the obvious case (duplicate calls to the same step). Version checks catch the subtle case (two different operations racing on the same version).
- The agent never manages versions. The engine handles versioning internally between its own read and write. The `snapshot_id` in the ResponseEnvelope is informational (for developer logs), not a token the agent must track.
- Auto-execution chains are atomic from the store's perspective — the chain holds the record in memory, updates once at the start (pending) and once at the end (final). External calls during the chain see the pending state and are blocked.
- The store interface (`updateRun(runId, expectedVersion, updates)`) must support atomic versioned writes from Phase 1. Both `JsonFileStore` and `PostgresStore` implement this interface. The version check is in the store, not in the engine.

### Decision: Three-phase run lifecycle with content deduplication and eviction

**Context:** The engine accumulates run records with evidence snapshots including full document content. Without a defined lifecycle, runs persist indefinitely, storage grows unbounded, and there's no distinction between "this run is still active" and "this run finished a month ago."

**Decision:** Three lifecycle phases (active → terminal → archived → deleted) with four terminal states, content deduplication by SHA-256 hash, content eviction on archival, and configurable retention policies.

**Reasoning:**
- Four terminal states (completed, cancelled, failed, abandoned) cover all end conditions. The `failed` vs `abandoned` distinction matters for diagnostics — failure rate indicates workflow bugs, abandonment rate indicates UX or timeout issues.
- `failed` and `abandoned` are resumable, `completed` and `cancelled` are not. Resume for abandoned runs includes a warning about stale external data. This gives developers recovery options without letting them resume runs that ended intentionally.
- Content deduplication by hash prevents 50 scheduled runs from storing 50 copies of the same document. The content is stored once, runs hold references. Garbage collection removes orphaned content.
- Content eviction on archival caps long-term storage growth. The audit trail (hash, metadata, char count, format, timestamps) survives eviction — the developer knows what was used even if the actual text is gone. The developer can re-fetch from the original URL if needed.
- Retention is configurable per workflow with sensible defaults (30 days to archive, 365 days to delete). A minimal workflow YAML needs no retention section. Enterprise deployments can set "never delete" for compliance.
- Cleanup triggers differ by deployment: lazy on `create_run` for local (simple, no infrastructure), nightly cron for cloud (predictable, reportable). Both support manual `realm cleanup` with dry-run preview.

### Decision: Separate `submit_human_response` MCP tool with gate_id binding

**Context:** When a step requires human confirmation, the engine returns `confirm_required` to the agent. The agent must relay the user's decision back to the engine. The question was whether to use `execute_step` for this or a separate tool, and how to verify the response reflects a real human decision.

**Decision:** A separate `submit_human_response` MCP tool with a `gate_id` that binds the response to the specific gate instance. Three mitigations for verifying human involvement: protocol guidance, `user_message` in the evidence chain, and `review_challenge` for `human_reviewed` gates.

**Reasoning:**
- Separate tool makes the gate semantically distinct from step execution. The evidence chain records "human response" not "step execution." Clean separation in the MCP tool list (6 tools total) reduces agent confusion.
- `gate_id` binding prevents a critical bug: the agent receives a preview, the conversation continues for several turns, and the agent submits a confirmation for a gate it hallucinated from context. The gate_id must match the pending gate exactly.
- The engine can't fully verify the user decided (it talks to the agent, not the user). Three graduated mitigations: protocol instruction (guidance), `user_message` field (audit evidence), and `review_challenge` (friction — the agent must extract an answer from the preview, detectable if `response_time_seconds` is suspiciously low). `human_confirmed` uses the first two. `human_reviewed` adds the third.
- User questions during pending confirmation don't affect run state — the engine only accepts `submit_human_response` in `awaiting_human_confirmation` state. `get_run_state` lets the agent rediscover the pending gate if it loses context.
- Gates support any set of named choices (not just confirm/cancel), choice descriptions, partial approval with `choice_data`, and step-specific preview formats. This makes gates flexible enough for multi-option decisions, approval with exclusions, and tiered selections.

---

### Decision: Snapshot-at-start workflow versioning

**Context:** When a developer re-registers a workflow, in-progress runs could continue on the old version (snapshot), fail with a version mismatch, or pick up the new version mid-run.

**Decision:** Snapshot the full workflow definition into the run record at `start_run`. In-progress runs always use their snapshot, unaffected by re-registration. Resume uses the snapshot by default, with an explicit `--use-current-workflow` flag for upgrading.

**Reasoning:**
- Consistent with the existing snapshot pattern for schemas (snapshotted at run start) and documents (snapshotted at fetch). One rule for everything: the run record is self-contained.
- Picking up new versions mid-run is dangerous: changed state names break transitions, changed input schemas invalidate evidence, changed step logic produces inconsistent results within a single run.
- Failing in-progress runs on re-registration is too aggressive: a typo fix in a description shouldn't kill active runs.
- Auto-incrementing version on each `realm register` enables cloud version management (group runs by version, compute per-version metrics) with zero additional infrastructure.
- Resume with `--use-current-workflow` covers the "I fixed the bug, resume with the fix" use case explicitly. The evidence chain records the upgrade so the audit trail shows the version change.

### Decision: YAML-only workflow definitions with extended expression language

**Context:** Should Realm support code-based (TypeScript) workflow definitions alongside YAML, to handle loops, dynamic step generation, and complex input transforms?

**Decision:** YAML is the only workflow definition format. No TypeScript builder API. Complex logic goes in registered extensions (processors, step handlers, adapters), not in workflow definitions. The YAML format is extended with control flow primitives and an expression language to cover all declarative use cases. A JSON Schema is published for IDE autocomplete and validation.

**New YAML primitives:**

- `type: for_each` — iterate over a step result with `over`, `as`, `concurrency`, `on_error` (skip/retry/stop), `break_when`, and `accumulate` for cross-iteration state.
- `type: while` — repeat until a condition is met, with `condition`, `max_iterations` (safety limit), and `delay_seconds`.
- `type: parallel` — fan-out into concurrent `branches`, engine waits for all to complete before proceeding.
- `type: call_workflow` — invoke another registered workflow as a child run with `workflow_id` and `params_map`.
- `input_map` — per-step input transforms using the expression language instead of raw data passthrough.
- `on_error: fallback` with `fallback_step` — error recovery that routes to an alternative step.
- `accumulate` / `accumulate_init` — cross-iteration accumulators for `for_each` loops.

**Expression language (used in `input_map`, `preconditions`, `when`, `over`, `condition`, `break_when`, `accumulate`):**

Supports: property access (`a.b.c`), comparisons (`==`, `!=`, `>`, `<`, `>=`, `<=`), boolean logic (`&&`, `||`, `!`), ternary (`condition ? a : b`), pipe filters (`| count`, `| where(...)`, `| first`, `| flatten`, `| join(', ')`, `| uppercase`, `| lowercase`), array indexing (`results[0]`), array concatenation (`list + [item]`), arithmetic (`+`, `-`, `*`, `/`), and literals (strings, numbers, booleans, null, arrays, objects).

Does NOT support: variable assignment, function definitions, imports, closures, network access, filesystem access, or anything that would make it a programming language. It is an expression evaluator, not a scripting engine. Same category as Terraform HCL expressions and GitHub Actions `${{ }}` expressions.

**Example — complete batch processing workflow in YAML:**

```yaml
id: batch-invoice-extraction
name: "Batch Invoice Extraction"

services:
  drive: { adapter: google_drive, auth: { token_from: secrets.gdrive_oauth } }
  accounting: { adapter: quickbooks, auth: { token_from: secrets.qb_token } }

steps:
  fetch_invoices:
    description: "Fetch all PDFs from the drive folder"
    execution: auto
    uses_service: drive

  process_invoices:
    description: "Extract and write each invoice"
    type: for_each
    over: "fetch_invoices.result.documents"
    as: invoice
    concurrency: 1
    on_error: skip
    accumulate_init:
      succeeded: 0
      failed_ids: []
    accumulate:
      succeeded: "write.status == 'ok' ? succeeded + 1 : succeeded"
      failed_ids: "write.status != 'ok' ? failed_ids + [invoice.id] : failed_ids"
    steps:
      extract_line_items:
        execution: agent
        input_map:
          document: "invoice.text"
          schema: "workflow.schema"
      validate:
        execution: auto
        handler: validate_candidates
      confirm:
        execution: human_gate
        gate_config:
          choices: [approve, reject]
          preview_from: "validate.result.accepted_fields"
      write:
        execution: auto
        uses_service: accounting
        preconditions:
          - "confirm.result == 'approve'"

  summary:
    description: "Report batch results"
    execution: auto
    handler: summarize_batch
    input_map:
      total: "fetch_invoices.result.documents | count"
      succeeded: "process_invoices.result.succeeded"
      failed: "process_invoices.result.failed_ids"
```

**Reasoning:**

- YAML + expressions covers 100% of real use cases. Loops, conditionals, parallel branches, sub-workflows, input transforms, accumulators, and error fallbacks are all expressible declaratively.
- The only thing TypeScript would add is IDE autocomplete (solved by publishing a JSON Schema) and dynamic step generation at registration time (too exotic to justify a second workflow format).
- A single format is simpler for the engine (one parser, one validator, one protocol generator), simpler for documentation, simpler for the cloud (no code execution, no sandboxing, no security risk).
- Complex logic belongs in registered extensions (step handlers, processors, adapters), not in workflow definitions. The YAML says "what to do and in what order." The TypeScript extensions implement "how to do it." This is the same separation Kubernetes uses: YAML for declarations, Go for controllers.
- Cloud safety: YAML + expressions can never execute arbitrary code. The expression evaluator is a controlled sandbox that can only read step results and workflow config. No imports, no network calls, no filesystem access. This makes cloud execution safe by design, not by sandboxing.
- The expression language is the same one already designed for preconditions. Extending it to handle `input_map`, `over`, `condition`, and `accumulate` is incremental, not a new system.

**Implementation phases:**

| Phase | Capability |
|-------|-----------|
| Phase 1 | Linear steps, preconditions (boolean expressions only) |
| Phase 2-3 | `input_map` with full expression language, `on_error` with fallback |
| Phase 3-4 | `type: for_each` with `accumulate`, `type: parallel` |
| Phase 4-5 | `type: while`, `type: call_workflow`, `break_when` |
| Phase 2 (tooling) | JSON Schema for workflow YAML, published at `sensigo.dev/realm/schema/workflow.json` |

---

## Part 12: Strategy Notes

### Competition analysis

**Why nobody will steal the idea:**

The people who could build this fast (well-funded AI infrastructure teams) are building horizontal platforms — general-purpose agent frameworks, RAG pipelines, model serving. The "verified write pipeline with evidence chains" insight is too specific and too opinionated for a big company to prioritize. They build horizontal; this product is vertical.

The people who are in the same problem space (developers building AI workflows) won't see a blog post and go build a competing cloud service. They'll use the open source tool. The ones technical enough to rebuild it from scratch would rather contribute to an existing project.

The scenario to worry about — someone reads the blog post, fully understands the depth of the architecture, and ships a hosted version first — requires a person with the exact same insight, domain experience, and more resources, who happens to be idle. That person doesn't exist.

**The real moat is three things competitors can't copy quickly:**

1. Domain knowledge baked into the implementation — verbatim quote matching with whitespace normalization and fuzzy fallback, branding gates checking the first 20% of documents, identity resolution with company name variants, two-pass extraction (literal cue scan then section sweep). None of this would be in a blog post. It's the result of building a real system against real failure modes.

2. The canonical schema pattern — field definitions encoding allowed sections, disallowed sections, positive cues, negative cues, examples, anti-examples, and validation rules. This is a domain-specific extraction ontology that took real iteration. A competitor would need months of their own iteration for even one domain.

3. Understanding why the design decisions were made — why the identity gate is at score 70, why branding checks use the first 20%, why `store_candidates` uses a Python heredoc. Every decision came from a real failure that was hit and fixed.

**Note from the developer:** The domain-specific knowledge (property management playbooks, Bubble field mappings, cue lists) is from a specific client project. It's not the product — it's the first workflow built on the product. The platform itself should be domain-agnostic. Competitors would need to build their own domain knowledge for their own use cases, which is exactly what the platform helps them do.

**The real risks (not competition):**

Risk 1: Building the cloud service for 6 weeks, launching, and nobody cares — because demand was never validated. Open sourcing first mitigates this directly.

Risk 2: Moving so slowly out of fear that the window closes — not because a competitor took the idea, but because the AI agent ecosystem moved on. Shipping the open source core quickly keeps the project in the conversation while it's happening.

### Pricing evolution

The pricing recommendation evolved through the conversation:

1. **Original instinct:** $5/month SaaS. Rejected — signals "not serious" to the exact buyers who'd pay more.

2. **Original agent's proposal:** $29/month (Builder) / $99/month (Team). Good tiering but premature — don't build billing before validating demand.

3. **Expanded model (final):** Three revenue streams:
   - Cloud subscription: $49/month per team (collaboration, analytics, AI diagnostics, scheduled runs)
   - Plugins: $5-29 one-time (premium processors, service adapters, domain schema packs)
   - Project bundles: $29-49 one-time (complete workflow + schema + adapters for a specific use case)
   - Enterprise: custom pricing (SSO, compliance export, SLA)

Why $49 instead of $29: the people who need verified AI actions in production are building real products at companies that spend $49/month without a procurement process. The $29 tier from the original proposal is in an awkward middle — too expensive for hobbyists, too cheap to signal seriousness to professional buyers.

Plugins use one-time pricing to avoid subscription fatigue — developers hate paying monthly for small tools. A one-time $9-49 purchase feels fair for something that saves days of work.

Validate before building billing: a Stripe checkout page with the $49 plan and a waitlist is a weekend project, not a 4–5 day phase. Test pricing before investing in the full billing infrastructure.

See Part 13 for full details on the cloud value proposition and plugin model.

### Open source launch strategy

Don't just dump code on GitHub. The sequence:

1. **Write a technical blog post** explaining the pattern — the problem (LLMs writing to production databases are unauditable), the insight (treat it as a trust protocol with evidence chains), the solution. Use the clozr extraction pipeline as a concrete case study. The headline angle: "How to let AI agents write to your database without losing sleep."

2. **Release the open source runtime alongside the post.** Not "here's a library" but "here's a protocol spec and a reference implementation." Include a working example that people can run locally in 5 minutes.

3. **Post on Hacker News, Reddit (r/LocalLLaMA, r/MachineLearning), relevant Discord servers.** The post should resonate because it names a real problem developers feel but haven't articulated.

4. **Measure signal:** GitHub stars, npm installs, comments, people asking "can I use this for X?" If the post resonates, proceed to the cloud app. If not, learn why before investing further.

### Product positioning

**Weak positioning (too abstract):** "AI workflow state management" or "Verified AI actions for production systems." Sounds like infrastructure. Infrastructure is hard to sell to developers who think they can build their own.

**Strong positioning (pain-driven):** "AI workflows that seem simple keep failing in ways you can't diagnose. We fix that." Every developer who's spent a week debugging why their extraction prompt suddenly started missing fields will feel that.

**The one-liner:** "Your state machine tells the AI what to do. The AI never decides what's next."

**The elevator pitch:** "Developers build AI workflows — extract data from documents, write to databases, process emails. These workflows seem simple but fail in unpredictable ways because LLMs skip steps, hallucinate values, and lose track of where they are. Our toolkit gives the AI agent step-by-step instructions it can't deviate from, verifies its work with evidence, and gives the developer a complete log of what happened so they can tune the workflow without rewriting prompts."

### CV and career impact

Building this project is impressive on a CV only if it has real users. A beautifully architected open source project with 12 GitHub stars is less impressive than an ugly SaaS with 50 paying customers.

What makes it CV-defining: "I designed this protocol, N teams use it in production, and here's a case study showing it caught a hallucinated write that would have corrupted a customer's database."

The target paragraph for a CV or interview: "Created the Verified AI Actions protocol — an open source framework for auditable AI-to-database writes, adopted by N teams. Built and operate the managed cloud service. The core insight: treating LLM outputs as untrusted until proven by an evidence chain, rather than trusting the model to self-validate."

Build it to be used, not to be admired. The CV impact follows from adoption.

---

## Part 13: Cloud Value Proposition and Plugin Model

### The problem with "same thing but hosted"

The current build plan has a weakness: if the open source local version does everything a developer needs (run workflows, inspect logs via CLI, connect agents via MCP), the cloud version is just "the same thing but hosted" — and that's a hard sell when developers are comfortable running things locally.

The cloud version needs to offer capabilities that a local install genuinely can't provide. The key insight: the local version serves one developer with one agent on one machine. The cloud version serves teams, multiple agents, and accumulated intelligence across runs.

### Cloud-only feature 1: Cross-run intelligence

When you run a workflow locally 50 times, each run is an isolated JSON file. You can inspect any single run, but you can't easily answer: "which fields have the lowest extraction success rate across all runs?", "what's the average confidence score for identity verification this month?", "which positive cues actually produce matches and which ones never hit?"

The cloud aggregates data across all runs and provides analytics impossible to compute locally without building your own pipeline.

What this looks like in the dashboard:

```
Field Performance (last 30 days, 47 runs):
  leasing_fee:         94% success rate, avg confidence 0.91
  quick_pricing_intro: 89% success rate, avg confidence 0.87
  renewal_fee:         34% success rate, avg confidence 0.62
    → Top failure reason: "quote not found" (78% of failures)
    → Suggested action: add cues ["renewal", "lease renewal fee"]
      (these phrases appear in 12 documents where this field was missed)

Identity Verification:
  Auto-confirmed (score ≥70): 91% of runs
  Human gate triggered: 9% of runs
  Average confidence: 86

Processing Pipeline:
  Average document size: 42K chars
  PDF conversion failures: 2 of 47 runs (both due to scanned PDFs)
  Average pipeline time: 1.2s
```

The "suggested action" part is the real value — the cloud has enough data across runs to notice patterns. It can see that "renewal" appears in documents where `renewal_fee` extraction fails, and suggest adding it as a cue. A developer running locally would need to manually inspect dozens of run logs to spot this.

### Cloud-only feature 2: AI-powered workflow diagnostics

Instead of reading logs in a dashboard, the developer asks the cloud's AI assistant, which has access to all run data:

```
Developer: "Why does renewal_fee keep failing?"

Cloud AI:
  "renewal_fee failed in 31 of 47 runs. In 24 of those failures,
   the field was present in the document but not extracted.
   The most common pattern: the document uses the phrase
   'lease renewal fee' but your positive cues only include
   'renewal fee' (without 'lease'). Adding 'lease renewal fee'
   as a cue would have matched in 19 of the 24 missed cases.

   In the remaining 7 failures, the field genuinely wasn't
   in the document — those documents don't have a renewal
   fee section.

   Want me to add 'lease renewal fee' to the schema?"

Developer: "Yes"

Cloud AI: updates the schema, shows the diff, offers to
          re-run the last failed run with the new cue to verify
```

The local CLI can't do this — it doesn't have cross-run data and doesn't have an AI given context about your workflow's performance history. The cloud AI becomes your workflow tuning assistant.

### Cloud-only feature 3: Workflow version management and rollback

Locally, when you change a workflow definition or schema, the old version is gone (unless you're using Git). The cloud tracks every change as a version:

```
Workflow: playbook-extraction
  v1.0 (Jan 15) — initial version, 14 fields tracked
  v1.1 (Jan 22) — added 'lease renewal fee' cue to renewal_fee
  v1.2 (Feb 3)  — lowered identity threshold from 70 to 60
  v1.3 (Feb 10) — added pdf_to_markdown processor

Performance by version:
  v1.0: 67% field success rate (47 runs)
  v1.1: 74% field success rate (31 runs)  ← +7% from one cue change
  v1.2: 75% field success rate (28 runs)  ← +1% from threshold change
  v1.3: 78% field success rate (15 runs)  ← +3% from PDF support
```

You see exactly which change improved (or degraded) performance. You can roll back to any previous version instantly. You can A/B test versions — run 50% of new runs on v1.3 and 50% on v1.2 to measure whether the PDF processor actually helps or introduces noise.

### Cloud-only feature 4: Team collaboration

A solo developer runs workflows locally and everything is in their head. A team needs shared visibility:

- Multiple developers working on the same workflow see each other's changes
- A developer defines the workflow, a QA person reviews run logs and flags problems, a domain expert tunes the schema (adds cues, adjusts sections)
- Role-based access: the developer can modify workflow steps, the domain expert can only edit the schema, the QA person can only view logs
- Comments on specific runs or specific step failures: "this field was rejected because the document uses a different format for phone numbers, we need to handle this"

### Cloud-only feature 5: Scheduled and triggered workflows

Locally, a workflow runs when someone (or an agent) explicitly starts it. The cloud runs workflows automatically:

- On a schedule: "extract fields from every new document added to this Google Drive folder, every day at 9am"
- On a trigger: "when a new record appears in the database, run the extraction workflow"
- On a webhook: "when our CRM sends a notification, start the update workflow"

Results go into the run history. The developer gets notified only if something fails or needs human confirmation. This turns the platform from a tool you use actively into a system that works in the background.

### Cloud-only feature 6: Workflow marketplace and templates

Developers share complete workflow definitions that others use as starting points — not just the YAML but the complete package including schema, protocol, and recommended service configurations:

```
Marketplace:
  "Invoice Field Extraction"
    by: @developer_jane
    uses: pdf_to_markdown, extract_fields, validate_evidence, api_write
    schema: 15 invoice fields (vendor, amount, date, line items, etc.)
    tested on: 200+ invoices, avg success rate: 82%
    price: free / $9 one-time for premium schema with 40+ fields

  "Contract Clause Detection"
    by: @legal_ai_tools
    uses: chunked_extraction, search_knowledge_base, human_gate
    schema: 28 contract clauses (termination, liability, IP, etc.)
    price: $19 one-time

  "Support Ticket Categorization"
    by: @helpdesk_dev
    uses: extract_fields, api_write
    schema: 8 ticket fields (category, priority, sentiment, etc.)
    price: free
```

### Paid plugins — sold cheaply or as bundles

Plugins are specific capabilities that extend the engine. They work both locally (npm install) and in the cloud. They represent a separate revenue stream from the cloud subscription.

**Plugin category 1: Premium processors ($5-15 each)**

Built-in processors are free and open source. Premium processors handle more complex or niche transformations:

- `advanced-pdf` ($9) — handles scanned PDFs with OCR, preserves complex table layouts, extracts embedded images
- `docx-to-markdown` ($5) — converts Word documents with tracked changes, comments, and formatting preserved as markdown annotations
- `email-parser` ($7) — parses .eml and .msg files, extracts body, attachments, headers, thread history
- `spreadsheet-extractor` ($9) — reads Excel/CSV files, understands multi-sheet workbooks, handles merged cells and formulas

**Plugin category 2: Service adapters ($5-15 each)**

Built-in adapters cover common services (generic HTTP, Google Docs). Premium adapters handle specific platforms with their quirks:

- `salesforce-adapter` ($15) — handles Salesforce's SOQL queries, bulk API, field-level security, record types
- `hubspot-adapter` ($9) — handles HubSpot's property API, association API, pipeline stages
- `quickbooks-adapter` ($12) — handles QuickBooks Online's OAuth refresh, invoice creation, item mapping
- `notion-adapter` ($7) — handles Notion's block-based API, database queries, page tree navigation

Each adapter handles authentication quirks, rate limiting, pagination, and data format mapping for that specific service.

**Plugin category 3: Domain schema packs ($9-29 each)**

Pre-built extraction schemas for specific industries — the positive cues, negative cues, section allowlists, and validation rules that took real iteration to develop:

- `real-estate-leasing` ($19) — 40+ fields for property management playbooks, lease agreements, tenant screening docs
- `legal-contracts` ($29) — 50+ clause definitions for commercial contracts, NDAs, employment agreements
- `saas-invoices` ($9) — 20+ fields for standard SaaS/subscription invoices
- `medical-records` ($19) — 30+ fields for patient intake forms, referral letters, lab reports

These are domain knowledge that takes months to build from scratch. Selling them as pre-built packs saves the developer that iteration time. They can use the pack as-is or customize it for their specific needs.

**Plugin category 4: Project bundles ($29-49)**

A complete workflow + schema + adapters packaged for a specific use case. Install and have a working pipeline in minutes:

- `invoice-to-quickbooks` ($39) — PDF invoice extraction + QuickBooks adapter + invoice schema + validation rules. End-to-end: drop a PDF, get a QuickBooks invoice created.
- `contract-review` ($49) — Document chunking + clause extraction + risk scoring + human review gates. End-to-end: upload a contract, get clause-by-clause analysis with risk flags.
- `crm-data-sync` ($29) — Multi-source extraction + Salesforce/HubSpot adapter + deduplication. End-to-end: feed documents, get CRM records created or updated.

### How plugins work technically

Plugins are npm packages that follow a standard interface. Installing a plugin registers its processors, adapters, or schemas with the engine:

```bash
npm install @realm/advanced-pdf
```

The plugin auto-registers when the engine starts. Developer references it in workflow YAML:

```yaml
processing_pipeline:
  - step: advanced-pdf           # from the plugin
    config:
      ocr: true
      preserve_tables: true
  - step: normalize_text          # built-in
  - step: compute_hash            # built-in
```

For the cloud version, premium plugins are enabled per-account. The developer activates them in the dashboard and they become available in all their cloud workflows.

### Plugin licensing model

- **Free plugins:** MIT license, included in the open source package
- **Premium plugins:** One-time purchase, perpetual license for the purchaser. Works locally and in cloud. Updates included for one year, then optional renewal.
- **Project bundles:** Same as premium plugins but include everything needed for a specific use case

One-time pricing avoids subscription fatigue — developers hate paying monthly for small tools. A one-time $9-49 purchase feels fair for something that saves days of work.

### Revenue model summary

Three revenue streams:

| Stream | Model | Target | Revenue character |
|--------|-------|--------|-------------------|
| Cloud subscription | $49/month per team | Teams needing collaboration, analytics, AI diagnostics, scheduled runs | Recurring, primary revenue |
| Plugins & adapters | $5-29 one-time each | Individual developers who need specific capabilities | Volume play, pure margin (built once) |
| Project bundles | $29-49 one-time each | Developers solving a specific end-to-end problem | Higher conversion (solves complete problem) |
| Enterprise | Custom pricing | Companies needing SSO, compliance, SLA | High-value contracts |

The cloud subscription is the primary revenue. Plugins and bundles are supplementary revenue that also drive adoption — a developer who buys the `invoice-to-quickbooks` bundle and gets value is likely to become a cloud subscriber when their team grows.

### What the local version gets vs what requires cloud

| Capability | Local (free, open source) | Cloud ($49/month) |
|-----------|--------------------------|-------------------|
| Run workflows | Yes | Yes |
| MCP server for agent access | Yes | Yes |
| CLI inspection of individual runs | Yes | Yes |
| Evidence chain and audit trail per run | Yes | Yes |
| Custom processors (code) | Yes | Built-in only (+ webhooks) |
| Plugins (premium processors, adapters) | Yes (npm install) | Yes (activate in dashboard) |
| Cross-run analytics and field performance | No | Yes |
| AI-powered workflow diagnostics | No | Yes |
| Workflow version management and rollback | No (use Git) | Yes (built-in) |
| Performance comparison across versions | No | Yes |
| Team collaboration and role-based access | No | Yes |
| Scheduled and triggered workflows | No | Yes |
| Workflow marketplace | Browse only | Publish and sell |
| Comments on runs and step failures | No | Yes |

The local version is genuinely useful — a solo developer can build, run, and debug workflows entirely locally. The cloud version becomes valuable when you need to understand patterns across many runs, collaborate with a team, automate recurring workflows, or let an AI help you tune performance.

---

## Part 14: Architecture Model Comparison

This section compares the final architecture against every alternative model explored during the design process, documenting what survived, what was cut, and where the final model is stronger or weaker than each alternative.

### Model 1: Realm Protocol (early abstract proposal)

**What it was:** Formal `VerifiedAction` primitives with declared preconditions and evidence specs, `EvidenceChain` as a linked list of cryptographic nodes, `ContextContracts` with formal read/write declarations, `VerifiedComponent` interface with evidence specifications and trust declarations.

**What survived:**
- Evidence chain → became "evidence snapshots" — same concept but stored as simple JSON objects in the run record instead of a formal linked list with cryptographic linking
- Trust levels → survived almost intact (auto, human_notified, human_confirmed, human_reviewed)
- Context contracts → became the simpler pattern of "engine assembles what each step needs and delivers it in the response"

**What was cut:** The formalism. No `VerifiedComponent` interface — replaced by three minimal extension interfaces (ServiceAdapter, Processor, StepHandler). Precondition declarations were initially cut but later reintroduced as the second layer of the dual-guard model.

**Where the final model is stronger:** Simpler to implement, simpler to understand, simpler to debug. A developer reading the workflow YAML can see exactly what happens without understanding a formal verification protocol. The dual-guard model preserves the semantic richness of preconditions while keeping positional state guards as the fast path.

**Where the final model is weaker:** The expression language for preconditions is deliberately simple (path lookups and comparisons only). Model 1's preconditions could theoretically express more complex conditions. In practice, complex conditions are handled by step implementations returning different status values, so this limitation is acceptable.

### Model 2: Composable Component Platform (mid-conversation proposal)

**What it was:** Three-layer model: Component SDK, Workflow definitions (YAML), Schema definitions (JSON). Each component implemented a `VerifiedComponent` interface with `input_schema`, `output_schema`, `evidence_spec`, `trust_default`, and an `execute` method.

**What survived:**
- Three-layer separation → engine core (runtime), workflow definitions (YAML), domain schemas (JSON)
- Input/output schemas → became input schema validation per step

**What was cut:** The formal component model. Instead of implementing `VerifiedComponent` classes, the final model has three minimal extension interfaces (ServiceAdapter, Processor, StepHandler) — each one method plus an ID. Developers write YAML that references built-in capabilities and only write code for custom extensions.

**Where the final model is stronger:** Much lower barrier to entry. Building a new workflow means writing YAML, not implementing TypeScript classes. Custom code is only needed for genuinely custom operations (new service adapter, new processor, new step handler). The progressive disclosure model (simple YAML for simple workflows, advanced features when needed) is better for adoption.

**Where the final model is weaker:** Reusability is less formalized than Model 2's component model, but the three extension interfaces provide clean reuse paths: adapters are reusable across any workflow that talks to the same service, processors are reusable in any pipeline, and step handlers are reusable in any workflow that needs the same business logic. Workflow composition (sub-workflows) adds another reusability layer in Phase 4+.

### Model 3: Debuggable AI Execution Environment (the reframing)

**What it was:** Not a different architecture but a different framing. Primary user is the AI agent (executor), developer is the debugger/tuner. Product is "run AI workflows with full visibility into why the agent did what it did, and tune it without prompt engineering."

**What survived:** Everything. This framing shaped the entire final architecture — diagnostics layer, tuning loop, cloud AI diagnostics assistant, per-step trace with anomaly detection, parameter sensitivity analysis.

**Where the final model is stronger:** N/A — this isn't a competing model, it's the lens through which the final model is designed.

**Where the final model is weaker:** N/A.

### Model 4: Original agent's proposal (HTTP API + Cloudflare)

**What it was:** Three REST routes on Cloudflare Workers + Durable Objects. TypeScript. $29/month closed SaaS. No open source.

**What survived:**
- API surface concept (create run, execute step, inspect run)
- TypeScript as the language
- The core insight: LLM-as-stateless-executor with `next_action`

**What changed:**
- Transport: REST → MCP (agents connect natively)
- Infrastructure: Cloudflare Durable Objects → Postgres + Railway/Fly (simpler, lower learning curve)
- Business model: closed SaaS → open source core + cloud service + plugins
- Agent guidance: not addressed → skill file + MCP protocol pattern
- Evidence: not addressed → full evidence chain with snapshots
- Diagnostics: not addressed → per-step trace, anomaly detection, parameter sensitivity

**Where the final model is stronger:** MCP transport means any agent connects natively. The skill file + protocol pattern solves agent guidance. Evidence chain and diagnostics provide a moat. Open source enables adoption-driven growth. The resource trust model and processing pipelines handle document integrity and credential security. Auto-execution mode eliminates unnecessary round-trips.

**Where the final model is weaker:** The original proposal could ship faster. Three REST routes on Cloudflare is genuinely a few days of work. The final model has a much larger surface area (MCP server, structured next_action, auto-execution, evidence snapshots, timeouts, retries, input validation, processing pipelines, resource trust levels). The trade-off is a better product that takes longer to build.

### Summary comparison table

| Aspect | Model 1 (Realm) | Model 2 (Components) | Model 3 (Debuggable) | Model 4 (Agent's proposal) | Final model |
|--------|---------------------------|---------------------|----------------------|---------------------------|-------------|
| Abstraction level | Very high | High | Medium | Low | Medium |
| Time to ship | 6+ weeks | 4-6 weeks | N/A (framing) | 9-12 days | 16 weeks (phased) |
| Developer barrier | High (formal interfaces) | Medium (component classes) | N/A | Low (REST calls) | Low (YAML + CLI) |
| Agent guidance | Not addressed | Not addressed | Core feature | Not addressed | Core feature (next_action + protocol) |
| Evidence/audit | Formal chain | Per-component evidence | Diagnostics layer | Not addressed | Snapshots + diagnostics |
| Reliability features | Precondition guards | Component validation | Tuning loop | None | Timeouts, retries, resume, input validation |
| Reusability | Formal components | Formal components | N/A | None | Adapters + processors + sub-workflows |
| Auto-execution | No | No | No | No | Yes (9 of 12 steps skip agent) |

### What the final model uniquely provides that no earlier model had

1. **Auto-execution mode** — the realization that most workflow steps don't need the agent and can run engine-internally, eliminating round-trips and "wrong step" errors.
2. **Resource trust model** — three levels (engine_delivered, agent_fetched, engine_managed) solving document integrity, credential security, and format consistency in one unified framework.
3. **Processing pipelines** — inbound and outbound transformation chains with custom hooks and full audit trail per processor.
4. **Hash verification** — engine and agent working from the same document content, verified by SHA-256 hash comparison.
5. **Plugin model** — premium processors, service adapters, domain schemas, and project bundles as a revenue stream alongside the cloud subscription.
6. **Cloud cross-run intelligence** — analytics and AI diagnostics across workflow runs that the local version can't provide, giving the cloud a genuine value proposition beyond "hosted."

---

## Part 15: Known Weaknesses and Mitigations

Three areas where the final architecture has genuine weaknesses, with specific plans to address each.

### Weakness 1: Workflow definition complexity

**The problem:** The workflow YAML format has grown to include: service definitions, processing pipelines, resource trust levels, execution modes (auto/agent/hybrid), timeout policies, retry policies, input schemas, conditional branching, parallel groups, and sub-workflow references. A developer seeing this for the first time will be overwhelmed.

**The mitigation: progressive disclosure.**

A minimal workflow should be 10 lines of YAML:

```yaml
id: simple-extraction
name: "Simple Extraction"

steps:
  fetch_document:
    description: "Fetch the source document"
    uses_service: document_source
    next_action: "Call execute_step with command 'extract_fields'"

  extract_fields:
    description: "Extract fields from the document"
    execution: agent
    next_action: "Show results to the user"
```

Everything else has sensible defaults:
- No timeout declared → 60s default
- No retry declared → no retry
- No execution mode → agent mode
- No input schema → no validation (but a warning in logs)
- No trust level → auto
- No processing pipeline → none
- No branching → linear (next step in order)

The `realm init` command generates this minimal scaffold. Getting-started documentation uses progressive tutorials that add one feature at a time: "Now add a timeout to your fetch step... Now add a processing pipeline... Now add a human gate..."

Advanced features (parallel groups, sub-workflows, conditional branching, custom processors) are documented separately as "Advanced Workflow Patterns" — not in the getting-started guide.

### Weakness 2: Engine internal complexity (monolith risk)

**The problem:** The engine handles state management, step execution, evidence capture, resource fetching, document processing, hash verification, service proxying, credential management, timeout tracking, retry logic, input validation, flow graph evaluation, parallel coordination, and sub-workflow management. That's too many responsibilities for one component.

**The mitigation: explicit internal module boundaries.**

The engine is composed of six internal modules with clear interfaces:

```
Workflow Engine
├── runtime/
│   ├── state_guard.ts        # state machine, transition validation
│   ├── step_dispatcher.ts    # routes commands to step implementations
│   ├── auto_executor.ts      # chains auto-execution steps internally
│   └── flow_evaluator.ts     # branching, parallel groups, sub-workflows
│
├── evidence/
│   ├── snapshot_capture.ts   # captures inputs, outputs, hashes per step
│   ├── chain_manager.ts      # manages the evidence chain per run
│   └── diagnostics.ts        # trace, anomaly detection, parameter sensitivity
│
├── resources/
│   ├── fetcher.ts            # fetches URLs, applies trust levels
│   ├── pipeline.ts           # runs processing pipeline (inbound + outbound)
│   ├── hash_verifier.ts      # computes and compares SHA-256 hashes
│   └── chunk_manager.ts      # section-aware splitting, chunk delivery
│
├── services/
│   ├── adapter_registry.ts   # registers and retrieves service adapters
│   ├── credential_store.ts   # reads secrets from .env / config / cloud DB
│   └── http_proxy.ts         # makes HTTP calls for engine_managed services
│
├── reliability/
│   ├── timeout_tracker.ts    # per-step timeout management
│   ├── retry_handler.ts      # exponential backoff, retryable error detection
│   ├── input_validator.ts    # JSON Schema validation of step params
│   └── resume_manager.ts     # handles resume_run from failed step
│
└── store/
    ├── store_interface.ts    # abstract interface for run persistence
    ├── json_file_store.ts    # local: reads/writes runs/ directory
    └── postgres_store.ts     # cloud: reads/writes Postgres with JSONB
```

Each module communicates through the run record (the shared state) and well-defined function interfaces. No module reaches into another module's internals. The store interface is abstract — swapping JSON files for Postgres is a one-line configuration change.

This structure also maps cleanly to test boundaries. Each module can be unit-tested independently: the state guard doesn't need real HTTP calls, the retry handler doesn't need a real database, the hash verifier doesn't need a real document.

### Weakness 3: Testing story — now addressed (see Part 8b)

**Original problem:** The design document described how to build, run, and debug workflows but not how to test them before running against real data.

**Resolution:** A comprehensive five-level testing model is now documented in Part 8b: static validation (`realm validate`), unit testing of extensions, integration testing with fixtures (`realm test`), replay with parameter changes (`realm replay` + `realm diff`), and CI/CD integration. Three Phase 1 foundations support the entire testing stack: mock-able adapter interface, agent response injection, and test mode flag in the run record.

### Implementation priority for mitigations

| Mitigation | Phase | Dependency |
|-----------|-------|------------|
| Sensible defaults for YAML (progressive disclosure) | Phase 1 | None — design YAML format with defaults from the start |
| `realm init` scaffold generator | Phase 2 | Core engine working |
| Internal module boundaries | Phase 1 | None — structure the codebase this way from day one |
| Mock-able service adapter interface | Phase 1 | None — design the adapter interface with a mock implementation |
| `realm validate` (static workflow validation) | Phase 1 | Workflow YAML loader |
| Agent response injection in test mode | Phase 1 | Step dispatcher |
| Unit test utilities for extensions | Phase 2 | Extension interfaces |
| `realm test` command with fixtures | Phase 2-3 | Mock-able adapters, core engine, CLI |
| `realm replay` and `realm diff` | Phase 3 | Evidence snapshots, validation engine |
| CI/CD integration examples | Phase 4 (launch) | All of the above |
| Progressive tutorials and documentation | Phase 4 (launch) | Working examples to document |

---

## Part 16: Open Questions

1. ~~**What should the product be called?** — resolved: **Realm** (Reliable Agent Lifecycle Management). Company: Sensigo (`sensigo.dev`). Product page: `sensigo.dev/realm`. npm scope: `@sensigo/realm-*`. CLI binary: `realm`. GitHub: `github.com/sensigo/realm`.~~

2. **What's the second workflow?** Phase 3 requires building a workflow in a different domain to prove generality. Candidates: invoice extraction, contract clause detection, support ticket categorization. Should be a domain where a real user or real test data is available.

3. **How does the AI-assisted workflow creation work?** The cloud app vision includes creating workflows via chat ("I need to extract invoice fields from PDFs and write them to QuickBooks"). This is a Phase 5+ feature but the core engine should be designed to support it — the workflow YAML format should be simple enough for an AI to generate.

4. **How are secrets managed?** The current design references `secrets.bubble_api_key` in workflow definitions. Locally this could be a `.env` file or a JSON config. For the cloud, encrypted storage. The specific implementation needs to be designed.

5. **How does the VS Code integration work?** The user mentioned VS Code commands for external agents to access documentation and create/modify workflows. This could be a VS Code extension that wraps the CLI and MCP server, or it could be the MCP server itself (VS Code agents like Copilot can connect to MCP servers natively).

6. ~~**Custom step logic** — resolved: the StepHandler extension interface (Part 4) provides a clean way to implement custom business logic for any workflow step.~~

7. ~~**Testing story** — resolved: five-level testing model documented in Part 8b, with Phase 1 foundations (mock-able adapters, agent response injection, test mode flag).~~

8. ~~**Component abstraction** — resolved: three minimal extension interfaces (ServiceAdapter, Processor, StepHandler) documented in Part 4. Collectively called "extensions."~~

9. ~~**Positional state guard semantics** — resolved: dual-guard model (positional states + preconditions) documented in Part 4, with auto-resolution for complex workflows.~~

---

## Part 17: Pre-Build Clarifications

A full review of the design document identified thirteen items that need resolution. They are organized by urgency: items to address before writing code, items to address during early phases, and items to address later or as needed.

### Must address before building (affects core engine design)

~~**1. Error taxonomy and error handling strategy** — resolved: comprehensive error taxonomy documented in Part 4 "Error taxonomy and structured error handling." Covers six error categories (NETWORK, SERVICE, STATE, VALIDATION, ENGINE, RESOURCE) with specific codes, the `WorkflowError` object structure with `agent_action` field, the flow through retry logic to agent, self-correction via `provide_input`, evidence chain recording of all attempts, and extension error wrapping.~~

~~**2. Concurrency and locking** — resolved: concurrency control documented in Part 4 "Concurrency control and run locking." Two-layer model: version counter with optimistic concurrency check on every write (file locks for JSON store, WHERE clause for Postgres) plus intermediate pending states that block concurrent access through the state guard. Covers all four scenarios (agent retry, two agents, auto chain overlap, long-running steps). Store interface requires atomic `updateRun(runId, expectedVersion, updates)` from Phase 1.~~

~~**3. Run lifecycle and cleanup** — resolved: comprehensive lifecycle documented in Part 4 "Run lifecycle, retention, and cleanup." Three phases (active → terminal → archived → deleted) with four terminal states (completed, cancelled, failed, abandoned), resume rules per state, content deduplication by hash, content eviction on archival, configurable retention in workflow YAML with sensible defaults, cleanup triggers for local (lazy + CLI) and cloud (nightly scheduled job), and storage cost estimates.~~

~~**4. Human gate mechanics (end-to-end flow)** — resolved: comprehensive gate mechanics documented in Part 4 "Human gate mechanics." Covers the complete flow (engine issues gate with gate_id → agent shows preview → user decides → agent calls `submit_human_response` with gate_id and choice → engine verifies and proceeds), the `submit_human_response` MCP tool (separate from `execute_step`), gate_id binding to prevent hallucinated confirmations, user questions during pending confirmation (run state doesn't change, `get_run_state` rediscovers pending gate), three mitigations for verifying human involvement (protocol guidance, user_message in evidence, review_challenge for `human_reviewed` gates), custom gate types beyond confirm/cancel (multi-choice, partial approval with `choice_data`), and gate evidence in the audit trail with response_time_seconds for detecting auto-confirmation.~~

~~**5. Build plan update** — resolved: Part 9 now contains the revised phased plan. Phase 1 split into 1a (minimum viable engine, weeks 1-3) and 1b (reliability + human gates, weeks 4-5). Total timeline: 13 weeks to public launch, 20 weeks to cloud revenue. Includes critical path analysis, comparison table with original plan, and feature-to-phase mapping for every capability.~~

### Address during Phase 1-2 (important but can be designed alongside building)

~~**6. Workflow YAML example consistency** — resolved: Part 7 now contains two examples. A minimal example (15 lines, all defaults) showing progressive disclosure, and a complete example (full playbook extraction workflow) demonstrating every feature: execution modes, preconditions with auto_resolve, conditional branching, gate configs, input schemas, retry policies, timeouts, pending states, handler references, next_action templates, and protocol rules referencing the error taxonomy. Includes explanation of all defaults and the progressive disclosure pattern.~~

~~**7. `get_workflow_protocol` MCP tool detail** — resolved: full protocol response structure documented in Part 5 "The `get_workflow_protocol` response." Includes params_schema (what start_run needs), step list with execution mode and agent_involvement per step, input_schema per agent step, per-step instructions, agent_steps_summary (auto vs agent count), rules, error_handling mapped to agent_action values, quick_start paragraph, generation logic from workflow YAML, and the agent's usage flow showing how the protocol eliminates trial-and-error.~~

~~**8. Run versioning and in-progress runs** — resolved: workflow versioning documented in Part 7 "Workflow versioning and in-progress runs." Workflow definition snapshotted into run record at `start_run`. In-progress runs unaffected by re-registration. Auto-incrementing version on each `realm register`. Behavior table for all operations (start_run, execute_step, realm test, realm replay, realm resume). Resume supports explicit `--use-current-workflow` flag for upgrading a failed run to the fixed version.~~

~~**9. Outbound webhook/event system** — resolved: comprehensive event and webhook system documented in Part 7b "Outbound Events and Webhooks." Three event levels (run, step, gate) with 11 event types. Webhook configuration in workflow YAML with URL, auth, and custom body_template. Standard payload structure with three examples. Fire-and-forget delivery with 3-attempt retry. HMAC-SHA256 request signing. Evidence chain records all delivery attempts. Internal event bus architecture with phased listeners (evidence capture in Phase 1, webhook delivery in Phase 2, real-time streaming in Phase 5).~~

### Address later or as needed (not blocking for launch)

**10. Multi-agent workflows**

The design assumes one agent drives one workflow. But some workflows might benefit from different agents handling different steps — Claude for extraction (large context window), a specialized agent for code generation, a customer-facing agent for user interaction. Not needed for launch but worth considering whether the MCP tool interface should support an agent_id per step.

**11. Real-time run observability**

When a scheduled workflow runs in the cloud, can the developer watch it step-by-step in real time? A WebSocket or Server-Sent Events stream showing step progress would be valuable for the cloud dashboard. Design consideration: the engine's step completion events need to be publishable, not just stored.

**12. LLM cost tracking per run**

The engine doesn't make LLM calls directly, but it orchestrates the agent which does. For the cloud version, tracking token usage per run (reported by the agent or estimated from context sizes) would help developers manage AI spend. Could be a field in the evidence snapshot: `estimated_tokens: { input: 45000, output: 2000 }`.

**13. Internationalization**

The `next_action` strings, protocol rules, and error messages are in English. If a developer in a non-English-speaking country wants to use the platform, can the protocol and next_action be generated in their language? The `next_action_template` system in workflow YAML is language-agnostic (the developer writes the template in whatever language they want), but built-in error messages and the `get_workflow_protocol` structure would need a translation layer. Not urgent for launch but a design consideration for the YAML format.

### Priority summary

| Item | Priority | Affects |
|------|----------|---------|
| ~~1. Error taxonomy~~ | ~~Resolved (Part 4)~~ | ~~ResponseEnvelope structure, retry logic, agent error handling~~ |
| ~~2. Concurrency and locking~~ | ~~Resolved (Part 4)~~ | ~~Store interface design, snapshot_id usage~~ |
| ~~3. Run lifecycle and cleanup~~ | ~~Resolved (Part 4)~~ | ~~State names, terminal conditions, storage policy~~ |
| ~~4. Human gate mechanics~~ | ~~Resolved (Part 4)~~ | ~~MCP tool interface, step execution flow~~ |
| ~~5. Build plan update~~ | ~~Resolved (Part 9)~~ | ~~Phase scope, timeline, prioritization~~ |
| ~~6. YAML example consistency~~ | ~~Resolved (Part 7)~~ | ~~Documentation accuracy~~ |
| ~~7. Protocol tool detail~~ | ~~Resolved (Part 5)~~ | ~~MCP server implementation~~ |
| ~~8. Run versioning~~ | ~~Resolved (Part 7)~~ | ~~Workflow registration, run creation~~ |
| ~~9. Outbound webhooks~~ | ~~Resolved (Part 7b)~~ | ~~Cloud event system~~ |
| 10. Multi-agent workflows | Later | MCP tool interface |
| 11. Real-time observability | Later | Cloud dashboard, event system |
| 12. LLM cost tracking | Later | Evidence snapshots, cloud analytics |
| 13. Internationalization | Later | Template system, error messages |
