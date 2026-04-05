# Realm — Implementation Plan

## Context

This plan translates the design document (5,900+ lines, 26 decisions) and the profit roadmap (7 pain points, 6 phases, $45K-175K Year 1 target) into a week-by-week engineering plan at 10-15 hours/week.

**Key constraints:**
- Solo developer, evenings/weekends (~10-15 hrs/week)
- TypeScript, monorepo with turborepo
- Local: JSON file store. Cloud: Postgres
- First customer: clozr playbook extraction (existing Python CLI, rewritten on Realm)
- Revenue starts at Phase 4 (week 14). Everything before is adoption and validation.

**The one metric that matters:** Can a developer go from `npm install @sensigo/realm-cli` to a running workflow in under 10 minutes?

---

## Repository Setup (Day 0 — before Week 1)

Before writing any engine code, set up the workspace so every subsequent week is productive.

```
realm/
├── packages/
│   ├── core/           # @sensigo/realm
│   ├── cli/            # @sensigo/realm-cli (bin: realm)
│   ├── mcp-server/     # @sensigo/realm-mcp
│   └── testing/        # @sensigo/realm-testing
├── workflows/
│   └── playbook-extraction/
├── turbo.json
├── tsconfig.base.json
├── package.json        # workspace root
└── .github/
    └── workflows/
        └── ci.yml      # lint + type check + test on every push
```

Tasks:
- [ ] `npm init -w packages/core -w packages/cli -w packages/mcp-server -w packages/testing`
- [ ] turborepo config with `build`, `test`, `lint` pipelines
- [ ] tsconfig with strict mode, path aliases between packages
- [ ] ESLint + Prettier config
- [ ] Vitest as test runner (fast, TypeScript-native)
- [ ] CI: GitHub Actions running `turbo run lint test` on push
- [ ] `.env.example` for secrets (Bubble API key, Google Docs, Slack)

**Time:** 3-4 hours. Do not over-engineer this. No Docker, no database, no deployment. Just a working monorepo where `npm run build` and `npm run test` work.

---

## Phase 1a: Minimum Viable Engine (Weeks 1-3)

### Goal
Define a workflow in YAML, register it, start a run via CLI, execute steps, see evidence.

### Week 1 — Foundation (10-15 hrs)

**Files to create in `packages/core/src/`:**

```
core/src/
├── types/
│   ├── run-record.ts          # RunRecord interface
│   ├── response-envelope.ts   # ResponseEnvelope + next_action
│   ├── workflow-error.ts      # WorkflowError class with 6 categories
│   └── workflow-definition.ts # WorkflowDefinition from parsed YAML
├── store/
│   ├── store-interface.ts     # RunStore interface (get, create, update, list)
│   └── json-file-store.ts     # JSON file implementation with file locks + version counter
├── engine/
│   ├── state-guard.ts         # Positional state guard (O(1) set lookup)
│   └── execution-loop.ts     # load run → check guard → execute → update → return envelope
└── index.ts                   # public API exports
```

**Deliverables:**

1. **RunRecord type** — `id`, `workflow_id`, `workflow_version`, `state`, `version` (optimistic concurrency), `params`, `evidence` (array of step snapshots), `created_at`, `updated_at`, `terminal_state`, `terminal_reason`

2. **ResponseEnvelope type** — `command`, `run_id`, `status` (ok/error/blocked/confirm_required), `data`, `errors[]`, `warnings[]`, `next_action` (object with `instruction`, `human_readable`, `context_hint`, `expected_timeout`)

3. **WorkflowError class** — extends Error. Fields: `category` (NETWORK, SERVICE, STATE, VALIDATION, ENGINE, RESOURCE), `code` (string enum like `SERVICE_HTTP_5XX`), `agent_action` (report_to_user, provide_input, resolve_precondition, stop, wait_for_human), `retryable` (boolean), `details` (object)

4. **JsonFileStore** — reads/writes `~/.realm/runs/{run_id}.json`. Uses `proper-lockfile` npm package for file locking. Every `update()` call checks version counter — if version doesn't match, throws `CONCURRENT_MODIFICATION` error. Implements `RunStore` interface.

5. **Positional state guard** — given a step name and current state, checks if the step is allowed. Uses a `Map<string, Set<string>>` built from the workflow definition. O(1) lookup.

6. **Execution loop** — the core function: `executeStep(runId, stepName, input) → ResponseEnvelope`. Loads run from store, checks state guard, calls step dispatcher, captures evidence, updates state, returns envelope.

7. **`realm validate` CLI command** — parses workflow YAML, checks for: missing step definitions, broken state references, undefined service adapters, invalid schemas. Returns structured errors.

**Tests (Vitest):**
- RunRecord creation and serialization
- JsonFileStore: create, read, update, concurrent update rejection
- State guard: allowed/blocked transitions
- WorkflowError construction with all categories
- `realm validate` on valid and invalid YAML files

**Definition of done:** `npm run test` passes. `realm validate ./workflows/playbook-extraction/` runs and reports results.

---

### Week 2 — Step Execution and Evidence (10-15 hrs)

**Files to create:**

```
core/src/
├── extensions/
│   ├── service-adapter.ts     # ServiceAdapter interface (fetch, create, update)
│   ├── processor.ts           # Processor interface (process)
│   ├── step-handler.ts        # StepHandler interface (execute)
│   └── registry.ts            # ExtensionRegistry (register + lookup by name)
├── evidence/
│   └── snapshot.ts            # captureEvidence(step, input, output, timing) → EvidenceSnapshot
├── pipeline/
│   └── processing-pipeline.ts # run processors in sequence on content
├── adapters/
│   ├── mock-adapter.ts        # MockAdapter — returns pre-configured responses
│   └── http-adapter.ts        # GenericHttpAdapter — engine_managed HTTP calls
├── processors/
│   ├── normalize-text.ts      # smart quotes, dashes
│   └── compute-hash.ts        # SHA-256 of content
└── validation/
    └── input-schema.ts        # JSON Schema validation on step inputs
```

**Deliverables:**

1. **ServiceAdapter interface** — `fetch(operation, params, config): Promise<any>`, `create(operation, params, config): Promise<any>`, `update(operation, params, config): Promise<any>`. Each method receives operation name, typed params, and adapter config from YAML.

2. **Processor interface** — `process(content: string, config: object): Promise<{ content: string, metadata: object }>`. Pure transformation. No side effects.

3. **StepHandler interface** — `execute(inputs: object, context: StepContext): Promise<object>`. Full access to step context (run params, prior step results, workflow config).

4. **ExtensionRegistry** — `register(type, name, implementation)`, `get(type, name)`. Used at workflow registration to wire up adapters/processors/handlers by name.

5. **Evidence capture** — every step execution produces an `EvidenceSnapshot`: `{ step_id, started_at, completed_at, duration_ms, input_summary, output_summary, status, error?, evidence_hash }`. Stored in the run record's evidence array.

6. **Processing pipeline** — takes content + list of processor names, runs them in order, returns transformed content + accumulated metadata + final hash.

7. **MockAdapter** — wraps any ServiceAdapter. Given a map of `{ operation: response }`, returns pre-configured responses. Used in tests.

8. **GenericHttpAdapter** — makes HTTP requests to any REST API. Config: `{ base_url, headers, auth }`. Operations map to HTTP methods. Engine-managed — the agent never sees the HTTP details.

9. **Input schema validation** — before executing any step, validate the input against the step's `input_schema` (JSON Schema). On failure, return a `VALIDATION` WorkflowError with `agent_action: provide_input`.

10. **Secrets loading** — read `.env` file, make secrets available to adapters via `config.auth.token_from` resolution.

**Tests:**
- ServiceAdapter mock: configure responses, verify calls
- Processing pipeline: chain normalize + hash, verify output
- Evidence capture: execute step, verify snapshot fields
- Input schema validation: valid input passes, invalid rejected with structured error
- GenericHttpAdapter: mock HTTP responses, verify request construction

**Definition of done:** Can register an adapter, execute a step, capture evidence, validate input schemas. All through the execution loop from Week 1.

---

### Week 3 — First Working Workflow (10-15 hrs)

**Files to create:**

```
core/src/
├── workflow/
│   ├── yaml-loader.ts         # parse YAML, validate, produce WorkflowDefinition
│   ├── protocol-generator.ts  # generate agent-facing protocol from WorkflowDefinition
│   └── registrar.ts           # register workflow: load, validate, store
cli/src/
├── commands/
│   ├── validate.ts
│   ├── register.ts
│   └── run.ts                 # interactive step-by-step execution
workflows/
└── playbook-extraction/
    ├── workflow.yaml
    └── schema.json
```

**Deliverables:**

1. **YAML loader** — parses `workflow.yaml`, resolves service references, validates step names and state transitions, produces a typed `WorkflowDefinition` object. Uses `js-yaml` for parsing.

2. **`realm register ./path/`** — loads workflow directory, validates YAML, stores the WorkflowDefinition with auto-incremented version number, reports success or errors.

3. **`realm run ./path/ --params '{"company_name":"PMI Georgia"}'`** — interactive CLI. Starts a run, then loops: show current state + next_action → wait for input → execute step → show result → repeat until terminal state. This is the "can I use it?" moment.

4. **Simplified playbook extraction workflow** — 3-4 steps (not the full 12-step clozr pipeline). Enough to prove: YAML defines steps → engine drives execution → evidence is captured → structured errors work.

```yaml
# workflows/playbook-extraction/workflow.yaml
id: playbook-extraction
name: "Playbook Field Extraction"
version: 1

services:
  source:
    adapter: google_docs
    auth: { token_from: secrets.GDOCS_TOKEN }
    trust: engine_delivered
  target:
    adapter: bubble
    auth: { token_from: secrets.BUBBLE_API_KEY }
    trust: engine_managed

steps:
  fetch_document:
    description: "Fetch the playbook document"
    execution: auto
    uses_service: source
    produces_state: document_ready

  extract_fields:
    description: "Extract field values from the document"
    execution: agent
    input_schema:
      required: [candidates]
      properties:
        candidates:
          type: array
          items:
            required: [field_id, value, verbatim_quote]
    produces_state: candidates_stored

  validate_candidates:
    description: "Verify extracted quotes against source"
    execution: auto
    handler: validate_verbatim_quotes
    produces_state: validated

  write_to_target:
    description: "Write accepted fields to Bubble"
    execution: auto
    uses_service: target
    preconditions:
      - "validate_candidates.result.accepted_count > 0"
    produces_state: completed
```

5. **Google Docs adapter** — fetch document by URL, normalize text, compute hash. Ported from existing Python `documents.py`.

6. **Bubble adapter** — verify record exists, read fields, write fields. Ported from existing Python `bubble_adapter.py`.

**Tests:**
- YAML loader: valid workflow parses correctly, invalid YAML produces structured errors
- End-to-end: register workflow, start run, execute fetch_document (mocked), execute extract_fields (mock agent response), execute validate, execute write (mocked), verify evidence chain

**Definition of done:** `realm register ./workflows/playbook-extraction/` succeeds. `realm run` drives a 4-step workflow end-to-end with mocked external services. Evidence chain shows all 4 steps with inputs, outputs, timing.

**Milestone: Phase 1a complete. The engine exists.**

---

## Phase 1b: Reliability and Human Gates (Weeks 4-5)

### Week 4 — Reliability (10-15 hrs)

**Deliverables:**

1. **Step timeouts** — configurable per step in YAML (`timeout_seconds: 30`). Engine starts a timer when step execution begins. On timeout, WorkflowError with `category: ENGINE`, `code: STEP_TIMEOUT`, `agent_action: report_to_user`.

2. **Step-level retry** — configurable per step (`retry: { max_attempts: 3, backoff: exponential, base_delay_ms: 1000 }`). Engine retries on retryable errors. Evidence records each attempt.

3. **Pending states** — when a step starts execution, engine transitions to an intermediate pending state (e.g., `document_fetch_pending`). If another request tries to execute the same step, the state guard blocks it. Prevents concurrent execution of the same step.

4. **Run lifecycle** — terminal states (`completed`, `cancelled`, `failed`, `abandoned`). Resumable: `failed` and `abandoned`. Not resumable: `completed` and `cancelled`. `realm resume <run-id> --from <step>` restarts from a specific step.

5. **Stale run detection** — `realm cleanup --older-than 30d` marks runs with no activity as `abandoned`. `--dry-run` flag to preview.

**Tests:**
- Step timeout fires after configured delay
- Retry succeeds on second attempt after transient error
- Retry exhaustion produces STEP_RETRY_EXHAUSTED error
- Concurrent execution blocked by pending state
- Resume from failed step skips completed steps
- Cleanup marks stale runs

---

### Week 5 — Human Gates and Auto-Execution (10-15 hrs)

**Deliverables:**

1. **Human gate mechanics** — steps with `execution: human_gate` pause the run in `gate_waiting` state. The ResponseEnvelope includes `gate_id`, preview data, and available choices. The run stays paused until `submit_human_response` is called with the matching `gate_id`.

2. **`submit_human_response` in CLI** — `realm respond <run-id> --gate <gate-id> --choice approve`. Validates gate_id matches, transitions run to next state.

3. **Auto-execution mode** — after any step completes, if the next step is `execution: auto`, the engine executes it immediately without returning to the caller. Chains auto steps until reaching an agent step, human gate, or terminal state. A 12-step workflow with 9 auto steps only returns to the agent at 3 points.

4. **Precondition guard** — expression evaluator for preconditions. Parses boolean expressions against step results. `"validate_candidates.result.accepted_count > 0"` evaluates to true/false. On false, engine returns a `blocked` envelope with resolution instructions.

5. **Trust levels** — `auto` (no human involvement), `human_notified` (human is informed), `human_confirmed` (human must approve), `human_reviewed` (human must demonstrate review via challenge). Enforced by the engine before the step executes.

**Tests:**
- Human gate pauses run, submit_human_response resumes it
- Gate_id mismatch rejected
- Auto-execution chains 3 auto steps in one call
- Precondition evaluator: true passes, false blocks with message
- Trust level enforcement: human_confirmed without gate response → blocked

**Milestone: Phase 1b complete. Production-grade engine with retries, timeouts, human gates, auto-execution.**

---

## Phase 2: MCP Server, CLI Polish, Testing (Weeks 6-8)

### Week 6 — MCP Server (10-15 hrs)

**Files to create:**

```
mcp-server/src/
├── server.ts              # MCP server setup (stdio transport)
├── tools/
│   ├── list-workflows.ts
│   ├── get-workflow-protocol.ts
│   ├── start-run.ts
│   ├── execute-step.ts
│   ├── submit-human-response.ts
│   └── get-run-state.ts
└── protocol/
    └── generator.ts       # generate full protocol from WorkflowDefinition
```

**Deliverables:**

1. **MCP server** — 6 tools exposed via MCP protocol over stdio transport. Uses `@modelcontextprotocol/sdk`. Each tool maps to an engine function.
   `createRealmMcpServer(options?)` accepts optional `workflowStore` and `runStore` in its options object and forwards them into every tool registration. When not provided, tools fall back to `new JsonWorkflowStore()` / `new JsonFileStore()` pointing at `~/.realm/`. This injection pattern lets example `mcp-server.ts` files pass a pre-populated store so no `realm register` step is needed at the user's machine.

2. **Protocol generator** — from a WorkflowDefinition, generates the complete agent briefing: params_schema, step list with execution modes, input_schema per agent step, instructions per step, rules, error_handling with agent_action mapping, quick_start paragraph.

3. **`get_workflow_protocol` response** — this is what the agent reads before starting. Must be clear enough that an AI agent can drive the entire workflow from this document alone.

4. **Skill file template** — `realm init --skill` generates a SKILL.md that references the MCP server.

**Tests:**
- MCP server responds to all 6 tool calls
- Protocol generator produces valid, complete protocol from the code review workflow
- Start run → execute steps → complete run, all via MCP tool calls

**Definition of done:** Claude (or any MCP client) connects to the Realm MCP server, reads the protocol, and drives the playbook extraction workflow end-to-end.

---

### Week 7 — CLI Polish and Diagnostics (10-15 hrs)

**Deliverables:**

1. **`realm inspect <run-id>`** — pretty-prints the run record: state, step history, evidence chain, timing, errors. Color-coded terminal output.

2. **`realm replay <run-id> --with "step.param=value"`** — re-evaluates stored evidence with modified parameters. Shows what would change without executing anything. Useful for tuning extraction schemas.

3. **`realm diff <replay-a> <replay-b>`** — compares two replays side by side. Shows which fields changed, which steps produced different results.

4. **`realm init <name>`** — scaffolds a new workflow project: `workflow.yaml`, `schema.json`, `.env.example`, `README.md`.

5. **Per-step diagnostics** — each evidence snapshot includes a `diagnostics` field: execution time breakdown, input token count estimate, retry history, precondition evaluation trace.

---

### Week 8 — Testing Package (10-15 hrs)

**Files to create:**

```
testing/src/
├── test-runner.ts         # realm test command implementation
├── fixtures/
│   └── fixture-loader.ts  # load test fixtures from YAML
├── mocks/
│   ├── mock-service.ts    # auto-mock any ServiceAdapter
│   ├── mock-agent.ts      # inject pre-built agent responses
│   └── mock-gate.ts       # auto-respond to human gates in tests
└── assertions/
    └── evidence.ts        # assert on evidence chain properties
```

**Deliverables:**

1. **`@sensigo/realm-testing` package** — utilities for testing workflows, adapters, processors, step handlers.

2. **`realm test ./path/ --fixtures ./fixtures/`** — runs a workflow against test fixtures with mocked services and pre-built agent responses. Verifies the workflow completes successfully and evidence matches expectations.

3. **Test fixture format:**
```yaml
# fixtures/happy-path.yaml
name: "Happy path — all fields extracted"
params:
  company_name: "PMI Georgia"
  document_url: "https://docs.google.com/..."
mocks:
  google_docs:
    fetch_document: { text: "...document content...", hash: "abc123" }
  bubble:
    verify_record: { exists: true, record: { id: "rec_123" } }
agent_responses:
  extract_fields:
    candidates:
      - field_id: "quick_pricing_intro"
        value: "10% of monthly rent"
        verbatim_quote: "we charge 10% of the monthly rent collected"
expected:
  final_state: completed
  accepted_fields: ["quick_pricing_intro"]
```

4. **`testStepHandler(handler, input, context)`** — unit test helper for step handlers.
5. **`testProcessor(processor, content, config)`** — unit test helper for processors.
6. **`testAdapter(adapter, operation, params)`** — unit test helper for adapters.

**Milestone: Phase 2 complete. AI agents can drive workflows via MCP. Full testing toolkit. Developer inspects and replays runs.**

---

## Phase 3: Progressive Examples, Multi-Agent Demo, Branching, Templates (Weeks 9-13)

**Full example specifications:** `.private/realm-examples.md`

### Week 9 — Examples 1 + 2 + Engine Features for Example 3 (10-15 hrs)

**Goal:** Ship Examples 1 and 2 as fully runnable demos. Lay the engine groundwork that Example 3 requires.

**Engine deliverables (required by Example 1):**

1. **`step.prompt` with template resolution** — new optional `prompt?: string` field on `StepDefinition` (all step types). At step entry, the engine resolves template references (`run.params.X`, `context.resources.X.Y`) against live run state and includes the resolved string in the `next_action` response as `next_action.prompt`. This is the mechanism that enables the thin SKILL.md pattern — the agent's task instruction is delivered at runtime, not authored into a static skill file.

**Engine deliverables (required by Example 3):**

2. **Conditional branching** — `transitions` field on `StepDefinition` with `on_success`, `on_error`, `on_confirm`, `on_cancel`. Condition expressions evaluated by the precondition evaluator. Required for the identity gate bypass path in Example 3.

3. **`input_map` with expression language** — steps declare how prior step outputs map to their inputs. Expression evaluator extended from preconditions to handle dot-path access, simple comparisons, ternary. Required for passing `fetch_document` text into `check_identity`.

4. **`on_error: fallback`** — error recovery routes to an alternative step.

**New adapters (in `packages/core/src/adapters/`):**

5. **`FileSystemAdapter`** — reads `.txt`/`.md` files via `fetch()`, writes JSON via `create()`. No auth, no network. Used in Examples 2 and 3 as the Google Docs stand-in.

**Example 1 — Structured Code Review (`examples/code-review/`):**
- `workflow.yaml` with `step.prompt` on all three steps (security analysis, quality assessment, gate report)
- `skill.md` — thin 8-line dispatch file, no domain rules
- 2 fixtures (findings-approved, findings-rejected)
- `driver.ts` (Mode 2 headless) + `mcp-server.ts` (Mode 1 VS Code Copilot)
  - `mcp-server.ts` registers the workflow into its own `JsonWorkflowStore` instance at startup and passes it to `createRealmMcpServer({ workflowStore })`. No `realm register` is required for the example to work.
- `README.md` with 5-section structure including the before/after SKILL.md comparison
- `realm test` passing on both fixtures

**Example 2 — CHANGELOG Entry Extraction (`examples/changelog-extract/`):**
- `workflow.yaml` using `FileSystemAdapter` for source + output, with `pipeline: [normalize_text, compute_hash]` on `fetch_document`
- `validate-verbatim-quotes` handler in `packages/core/src/handlers/` (shared with Example 3)
- `skill.md` — thin 4-step dispatch, no human gate
- 3 fixtures (all accepted, some rejected, all rejected / precondition block)
- `driver.ts` + `mcp-server.ts` + `README.md`
- `realm test` passing on all three fixtures

**Tests:** All existing tests must continue to pass. New tests for `step.prompt` template resolution, branching engine, `input_map`, `FileSystemAdapter`.

---

### Week 10-11 — Example 3 + Agent Profiles (20-30 hrs)

**Goal:** Ship Example 3 — the PR Description Generator. Add agent profiles for the multi-agent demo blog post.

**New adapters and servers:**

1. **`GitHubAdapter`** (`packages/core/src/adapters/github-adapter.ts`) — three operations:
   - `fetch('get_pr_diff', { repo, pr_number })` → `{ diff_text, pr_title, base_branch, files_changed[] }`
   - `fetch('get_linked_issues', { repo, pr_number })` → `{ issues: [{ number, title, body, state }] }`
   - `update('set_pr_description', { repo, pr_number, body })` → GitHub PATCH
   Configurable `base_url` so it points at mock server in demo and at `https://api.github.com` in production.

2. **`GitHubMockServer`** (`packages/testing/src/servers/github-mock-server.ts`) — lightweight Node.js `http` server (no framework). Accepts GitHub API routes, returns fixture data from `github-fixture-data.json`. Started by the example's setup script on `localhost:3032`.

**New handler in `packages/core/src/handlers/`:**

3. **`check-repo-identity`** — compares `run.params.repo` against `context.resources.fetch_diff.repo`. Exact match → `{ confidence: 'high' }`. Same org → `{ confidence: 'low' }` (triggers gate). Different org → throws `ENGINE_HANDLER_FAILED`.

**Example 3 — PR Description Generator (`examples/pr-description/`):**
- `workflow.yaml` — 7-step workflow with conditional identity gate bypass
- 1 domain-specific handler (`check-repo-identity`) + 1 reused from core (`validate_verbatim_quotes`)
- 3 fixtures (happy path, low confidence gate, all rejected precondition block)
- `fixtures/github-fixture-data.json` — static seed for `GitHubMockServer`
- `sample-diffs/feature-addition.diff` + `sample-diffs/mixed-changes.diff`
- `driver.ts` + `mcp-server.ts` + `README.md`
- `realm test` passing on all three fixtures

**Agent profiles:**

4. **`agent_profile` field on StepDefinition** — profile name references a markdown file in `workflow-dir/agents/`. Profile content injected into MCP protocol response for that step. Evidence snapshots record `agent_profile` used.

5. **Apply profiles to Example 3** — `extract_description` uses `pr-writer` profile; `confirm_description` uses `senior-reviewer` profile. Two agents, one run, evidence shows which profile did what.

---

---

### Week 12 — Step Templates + Replay Persistence (10-15 hrs)

**Deliverables:**

1. **Template YAML format** — reusable step groups with parameters:
```yaml
# templates/extract-and-validate.yaml
template_id: extract-and-validate
params:
  service_name: { required: true }
  human_gate: { default: true }
steps:
  extract:
    execution: agent
  validate:
    execution: auto
    handler: validate_candidates
  confirm:
    execution: human_gate
    when: "template_params.human_gate == true"
  write:
    execution: auto
    uses_service: "{{ service_name }}"
```

2. **Template resolver** — parameter substitution, per-step overrides, prefix handling. Resolved at registration time (zero runtime overhead).

3. **Extract shared patterns** from the two workflows into templates.

4. **`realm validate` updated** to validate templates.

5. **Replay persistence (`ReplayStore`)** — persist named replay snapshots so `realm diff` can compare two replays by ID. Requires: a `ReplayStore` that stores `ReplayStepResult[]` alongside metadata (origin run ID, overrides applied, `created_at`); a `realm replay --save` flag that runs the replay and prints the persisted replay ID; and updating `realm diff` to accept replay IDs in addition to run IDs. Note: `realm diff <run-a> <run-b>` already works against persisted `RunRecord` objects (Week 7). This item extends it to replay outputs. Deferred from Week 7 because `replayRun` is in-memory only and `ReplayStepResult[]` is not a `RunRecord` — it cannot be diffed without a persistence layer.

**Milestone: Phase 3 complete. Three runnable examples covering simple-to-complex. Full Clozr architecture demonstrated on Realm. Multi-agent profiles. Conditional branching. Shared templates. Replay diffing.**

---

## Phase 4: Public Launch + Cloud MVP + RAG (Weeks 13-21)

### Week 13 — Documentation (10-15 hrs)

1. **Getting-started guide** — from `npm install` to running first workflow in under 10 minutes. Entry point is Example 1 (code review). Links to Examples 2 and 3 for progressive depth.

2. **Building-extensions guide** — how to write a `ServiceAdapter`, `Processor`, `StepHandler`. Uses `FileSystemAdapter` and `validate_verbatim_quotes` from the examples as reference implementations.

3. **Protocol spec** — how the engine works, for contributors.

4. **Data flow guide** — how data moves between steps via `context.resources`. Includes the authoring rule: never rely on the agent's context window for cross-step data; always reference prior step output via `context.resources.STEP_NAME.FIELD` in `step.prompt`. The engine resolves these references against the evidence chain before delivery.

5. **Demo assets** — GIF screen recordings for all three examples (Mode 2 headless terminal recording + `realm inspect` output). Embedded in root README.

6. **JSON Schema for workflow YAML** — published at `sensigo.dev/realm/schema/workflow.json` for IDE autocomplete.

---

### Week 14 — Public Launch (10-15 hrs)

1. **GitHub repo goes public**
2. **`npm publish` — @sensigo/realm, @sensigo/realm-cli, @sensigo/realm-mcp, @sensigo/realm-testing**
3. **Blog post:** "Three AI agents, one document, zero trust issues — how Realm coordinates multi-agent workflows with proof"
4. **Post to:** Hacker News, Reddit r/programming, r/artificial, Dev.to, Twitter/X
5. **Second blog post (queue for week after launch):** "Your RAG pipeline is lying to you — and you can't prove it isn't"
6. **Third blog post:** "Why your autonomous AI agent needs a flight recorder" (Mode 2 — self-directed execution)

**Revenue:** $0. Goal: 500+ GitHub stars, 100+ npm installs in first month.

**CRITICAL:** Do not start cloud development until you have signal from launch. If zero engagement, reassess positioning before investing 7 more weeks.

---

### Weeks 15-16 — Cloud API + Mode 3 Delegation (20-30 hrs)

**Only proceed if launch shows signal (stars, installs, questions, interest).**

1. **Postgres store** — same `RunStore` interface as JsonFileStore. Uses `pg` or Prisma. Optimistic concurrency via `WHERE version = $expected`.

2. **HTTP API** — Express or Fastify server. Same operations as MCP tools, exposed as REST endpoints. Auth via API keys.

3. **Mode 3: Delegated execution MCP tools:**
   - `create_delegated_workflow` — master agent creates workflow, receives scoped handles
   - `get_step_context` — sub-agent retrieves its assigned task via handle
   - `submit_result` — sub-agent submits work, Realm validates
   - `get_delegation_status` — master agent reviews all sub-agent performance
   - `retry_step` — master agent re-assigns failed steps

4. **Deploy** — Railway or Fly.io. Postgres via Neon or Supabase.

5. **User registration** — sign up, get API key, register workflows via API.

6. **A2A Agent Card generation** — emit delegation handles as A2A-compatible Agent Cards. `handle_id` maps to A2A `task_id`. Enables Mode 3 workflows to interoperate with any A2A-speaking agent runtime without changing the core engine.

---

### Weeks 17-18 — Dashboard (20-30 hrs)

1. **Next.js app** — run list, run inspector, evidence viewer, workflow registry.
2. **Evidence viewer** — click into any run, see every step's inputs/outputs/evidence. Color-coded by status.
3. **Workflow version management** — see all versions, compare results between versions.

---

### Weeks 19-20 — RAG + Cloud-Only Features (20-30 hrs)

1. **Vector DB adapters** — Pinecone and pgvector. Engine calls vector search, logs queries + results + scores as evidence.
2. **Quote verification against retrieved chunks** — the agent claims an answer came from chunk X, engine verifies.
3. **Auditable RAG step template** — pre-built YAML template wrapping any vector DB in evidence chain.
4. **Cross-run analytics** — field performance trending, error patterns, RAG retrieval quality.
5. **Scheduled workflows** — cron triggers via cloud scheduler.

---

### Week 21 — Billing (10-15 hrs)

1. **Stripe integration** — $49/month plan.
2. **Usage metering** — runs per month, documents indexed (for RAG pricing).
3. **Free tier** — 100 runs/month, 500 indexed documents.

**Milestone: Phase 4 complete. Cloud service live. First paying customers. RAG support.**

**Revenue target:** 10 paying customers = $490 MRR.

---

## Phase 5: Growth + Ecosystem (Weeks 22-31)

### Weeks 22-24 — RAG Premium Features

1. **Managed vector storage** — developers upload documents, Realm handles chunking, embedding, indexing. $0.10 per 1K documents/month.
2. **Chroma adapter** (free).
3. **RAG quality scoring** — cross-run retrieval analysis.
4. **Retrieval drift detection** — alerts when RAG quality degrades.

### Weeks 25-27 — Domain Bundles + Adapters

1. **Real Estate Leasing Pack** ($19) — based on clozr workflow.
2. **Invoice Processing Pack** ($39) — PDF + QuickBooks adapter + schema + template.
3. **Salesforce adapter** ($19), **HubSpot adapter** ($9).
4. **Slack adapter** (free) — human gates via Slack messages.

### Weeks 28-29 — Enterprise Features

1. **SSO** (SAML/OIDC).
2. **Compliance export** — SOC 2, HIPAA evidence packages.
3. **Audit log search API**.
4. **Team collaboration** — multi-user access, role-based permissions.

### Weeks 30-31 — AI-Powered Diagnostics

1. **"Why did this fail?"** — cloud AI analyzes evidence chain and explains in plain English.
2. **"How can I improve this?"** — suggestions based on cross-run patterns.

**Revenue target:** $5K MRR by end of Phase 5.

---

### Weeks 32+ — Scale

Build based on demand signals only:

- `type: for_each` with accumulators — when users need batch processing
- `type: parallel` branches — when users hit performance bottlenecks
- `type: while` with safety limits — when users need polling/convergence
- `type: call_workflow` (sub-workflows) — when users need complex multi-stage pipelines
- `break_when` for early loop exit
- Mode 4: `query_sibling_result` with scoped permissions — agent-to-agent communication through Realm
- Self-improving evolution — automated failure analysis, AI-suggested schema improvements, confidence threshold tuning
- QuickBooks adapter ($19), Stripe adapter ($9)
- SAP adapter ($29), Snowflake adapter ($19)
- RAG fine-tuning pipeline
- Multi-tenant RAG
- Contract Review Pack ($49), Compliance Audit Pack ($49)

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Zero engagement at launch (week 13) | No point building cloud | Reassess positioning. Try different blog angles. Consider pivoting to consultancy using Realm internally. |
| Expression evaluator is too limited | Users can't express needed input transforms | Add pipe filters incrementally. Expression language is extensible by design. |
| MCP protocol changes | Server needs updating | MCP SDK abstracts transport. Pin SDK version, update on stable releases. |
| Clozr client churns before Realm is ready | Lose first case study | Clozr workflow works in Python today. Realm rewrite is parallel, not a dependency. |
| Solo developer burnout at 10-15 hrs/week | Timeline slips | Phases are designed so each week produces a testable deliverable. Momentum from visible progress prevents burnout. |
| Enterprise customer wants feature not in roadmap | Can't close deal | Custom step handler solves most cases without engine changes. Offer implementation as paid consulting. |
| Competitor launches similar product | Market confusion | The evidence chain + quote verification + multi-agent delegation is hard to replicate. Ship fast, build community. |
| Multi-agent handle system is too complex for early adopters | Feature goes unused | Mode 1 (guided) and Mode 2 (self-directed) work without handles. Mode 3 is additive, not required. |
| Agent runtimes don't pass handles to spawned agents reliably | Mode 3 breaks in practice | Mode 3 degrades gracefully to Mode 1 (single agent, multiple profiles). The skill file approach (Approach A) works as fallback. |

---

## Weekly Cadence

Every week follows the same pattern:

**Monday-Tuesday evening (3-4 hrs):** Write code for the week's primary deliverable.
**Wednesday-Thursday evening (3-4 hrs):** Write tests, fix issues from Monday-Tuesday.
**Friday evening or Saturday morning (2-3 hrs):** Polish, documentation, commit, push.
**Sunday (1-2 hrs):** Plan next week. Review what's working, what's not.

Every commit should leave the project in a working state. Every week should produce something you can demo or test.

---

## Success Checkpoints

| Week | Checkpoint | Pass/Fail criteria |
|------|-----------|-------------------|
| 3 | Engine runs a workflow | `realm run` completes a 4-step workflow with evidence |
| 5 | Engine is production-grade | Retries, timeouts, human gates, auto-execution all work |
| 6 | Agent can drive a workflow | Agent connects via MCP and completes a full workflow end-to-end |
| 8 | Testing works | `realm test` runs fixtures and reports pass/fail |
| 9 | Examples 1 + 2 ship | `node examples/code-review/driver.js` and `node examples/changelog-extract/driver.js` both exit 0 |
| 9 | Branching works | Conditional `transitions.on_condition` evaluated correctly in 3 new tests |
| 11 | Example 3 ships | `node examples/pr-description/driver.js` exits 0; full evidence chain printed |
| 11 | Platform is general | Three different-complexity examples run on the same engine |
| 11 | Multi-agent demo works | Example 3 uses 2 agent profiles, evidence records which profile ran each step |
| 12 | Mode 2 works | An agent creates its own dynamic workflow via `create_workflow` and self-tracks |
| 13 | Public launch | Repo public, npm published, multi-agent blog post live |
| 15 | Mode 3 works | Master agent creates delegated workflow, sub-agents use handles, quality reports work. Handles emitted as A2A Agent Cards (MCP or A2A). |
| 17 | Dashboard works | Web UI shows runs, evidence, workflow versions, per-agent performance |
| 20 | Revenue | First paying customer on $49/month plan |
| 30 | Ecosystem | 5+ adapters, 3+ domain bundles, Mode 4 if demand, $5K MRR |
