# Changelog

All notable changes to this project are documented here.

---

## [Unreleased]

### Added
- `call_with` field on `NextAction.instruction` — a ready-to-use flat argument object for calling the
  tool. For agent steps, `call_with.params` is a minimal schema skeleton object derived from
  `input_schema` (e.g. `{ findings: [{ severity: "<critical|high|medium|low>", description: "" }] }`)
  rather than a bare `<YOUR_PARAMS>` string — the agent can navigate and fill it in directly. For human
  gate responses, the placeholder remains a string (e.g. `<approve|reject>`).
- Optional `get_workflow_protocol` call documented as step 0 in the code-review skill — agents that
  prefer upfront schema discovery can call it before `start_run`.
- Optional `location` field added to `assess_quality.findings` items in the code-review example
  workflow (symmetric with the existing `location` field in `review_security`).
- `context_hint` promoted to a required top-level field on `ResponseEnvelope` — every response now
  carries orientation about the current run state and what just happened, including error and blocked
  responses where `next_action` is `null`. Previously only appeared inside `next_action`.
- JSDoc on `ResponseEnvelope.snapshot_id` (audit-only — do not parse) and `ResponseEnvelope.evidence`
  (debugging and CLI inspection only) to reduce agent confusion about opaque fields.
- `params_required` field on `NextAction.instruction` — each tool instruction now declares which
  parameters the agent must supply, separately from parameters pre-filled by the engine. Agent steps
  include `{ name: "params" }` (output shaped to `input_schema`). Human gate instructions include
  `{ name: "choice", valid_values: [...] }` so the agent knows both the key name and the allowed values
  without having to guess.
- `agent_action` field on `ResponseEnvelope` — every `error` and `blocked` response now includes
  `agent_action: AgentAction` (`stop`, `report_to_user`, `provide_input`, `resolve_precondition`,
  `wait_for_human`) so consuming agents can determine recovery strategy without parsing error text.
- `next_action` populated on recoverable error responses — when `agentAction !== 'stop'` and the
  run state is known, the error envelope includes a populated `next_action` pointing the agent to
  the correct next step. Agents no longer need to call `get_workflow_protocol` to recover.
- `next_action` populated on state-guard blocked responses — when the agent calls a step from the
  wrong state, the blocked response now includes `next_action` redirecting to the correct step.
  `blocked_reason.suggestion` indicates either the redirect or that no valid next step exists from
  the current state.

### Fixed
- `command` in `executeChain` responses now echoes the step name submitted by the caller, not the
  internally chained step name. Previously, chain-wrapped responses reported the wrong `command`,
  which caused agents to misinterpret which step had just completed.
- Terminal `context_hint` (emitted when a run reaches a terminal state) now explicitly directs the
  agent to call `get_run_state` with the run ID to retrieve the full evidence record, instead of
  ending without guidance.
- MCP `start_run`: returns a populated `next_action` when the first step is an agent step (previously
  returned `null`, causing the agent to stall on the very first call).
- MCP `execute_step`: evidence payloads in MCP tool responses are now truncated to avoid injecting
  oversized context into the agent's context window.
- MCP `confirm_required` responses now include a populated `next_action` with the correct
  `submit_human_response` instruction (previously `next_action` was `null`).
- `realm inspect`: step input/output fields are now truncated to 120 characters to prevent
  overwhelming terminal output on evidence-heavy runs.
- MCP tool catch handlers (`start_run`, `execute_step`, `submit_human_response`) now return
  structured JSON on unexpected exceptions instead of a bare `Error: <message>` string. All MCP
  responses are now JSON-parseable on every code path.
- `get_run_state`: error path replaced — was `isError: true` with plain-text `"Error: <message>"`;
  now returns a structured JSON envelope with `status: 'error'`, `agent_action: 'stop'`, and
  `context_hint`. No MCP tool now uses `isError: true`.
- `submit_human_response`: success path now strips `data` and `evidence` (same guard already applied
  by `execute_step`) — gate approval responses are no longer larger than regular step responses.
- `start_run`: all three return paths (no-steps, agent-step-first, auto-chain) now return a full
  `ResponseEnvelope` including `command`, `snapshot_id`, `evidence`, and `warnings`. Previously the
  non-auto paths returned a narrower object missing several envelope fields.
- `slimEvidence` extracted from `execute-step.ts` into a shared MCP utility (`slim-evidence.ts`),
  imported by `execute-step`, `submit-human-response`, and `start-run`.
- Dead code removed from `execution-loop.ts`: the unreachable `throw err` branch in the
  `validateInputSchema` catch block (which could only be reached if `validateInputSchema` threw a
  non-`WorkflowError` — it does not) has been removed.
- `FileSystemAdapter` — new built-in adapter in `@sensigo/realm` that reads a local file and returns
  `{ content, path, line_count, size_bytes }`. Add it to an `ExtensionRegistry` and reference it from
  a step with `uses_service: <name>` and `operation: read`. Validates that the path is non-empty and
  absolute; throws structured `WorkflowError` on ENOENT or read failure.
- `code-review` example upgraded to v2: now accepts `path: string` (absolute file path) instead of
  `code: string`. A `read_code` auto step reads the file via `FileSystemAdapter` with
  `trust: engine_delivered`; the file content is injected into the security and quality review prompts
  via `{{ context.resources.read_code.content }}`. Security review step now requires `owasp_category`,
  `location`, and `remediation` per finding. Quality review step adds a required `summary` field.

### Tests
285 tests across all packages (181 core, 42 CLI, 13 MCP, 40 testing).

---

## [0.1.0] — 2026-04-03

Initial release.

### Packages

- **`@sensigo/realm` 0.1.0** — Core workflow execution engine: state guard, execution loop, evidence capture with SHA-256 hash chaining, JSON schema validation, human gate support, precondition evaluation, extension registry (adapters, processors, step handlers), built-in `MockAdapter` and `GenericHttpAdapter`, JSON file store, YAML workflow loader.
- **`@sensigo/realm-cli` 0.1.0** — `realm` CLI with 11 commands: `init`, `validate`, `register`, `run`, `resume`, `respond`, `inspect`, `replay`, `diff`, `cleanup`, `test`.
- **`@sensigo/realm-mcp` 0.1.0** — `realm-mcp` MCP server exposing 6 tools to AI agents: `list_workflows`, `get_workflow_protocol`, `start_run`, `execute_step`, `submit_human_response`, `get_run_state`.
- **`@sensigo/realm-testing` 0.1.0** — Testing utilities: `InMemoryStore`, `MockServiceRecorder`, `createAgentDispatcher`, `createGateResponder`, evidence assertions (`assertFinalState`, `assertStepSucceeded`, `assertStepFailed`, `assertStepOutput`, `assertEvidenceHash`), unit test helpers (`testStepHandler`, `testProcessor`, `testAdapter`), fixture-based runner (`runFixtureTests`).

### Test coverage

226 tests across all packages (133 core, 42 CLI, 11 MCP, 40 testing).
