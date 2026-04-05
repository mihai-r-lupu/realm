# Changelog

All notable changes to this project are documented here.

---

## [Unreleased]

### Added
- `params_required` field on `NextAction.instruction` — each tool instruction now declares which
  parameters the agent must supply, separately from parameters pre-filled by the engine. Agent steps
  include `{ name: "params" }` (output shaped to `input_schema`). Human gate instructions include
  `{ name: "choice", valid_values: [...] }` so the agent knows both the key name and the allowed values
  without having to guess.

### Fixed
- MCP `start_run`: returns a populated `next_action` when the first step is an agent step (previously
  returned `null`, causing the agent to stall on the very first call).
- MCP `execute_step`: evidence payloads in MCP tool responses are now truncated to avoid injecting
  oversized context into the agent's context window.
- MCP `confirm_required` responses now include a populated `next_action` with the correct
  `submit_human_response` instruction (previously `next_action` was `null`).
- `realm inspect`: step input/output fields are now truncated to 120 characters to prevent
  overwhelming terminal output on evidence-heavy runs.

### Tests
250 tests across all packages (157 core, 42 CLI, 11 MCP, 40 testing).

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
