# Changelog

All notable changes to this project are documented here.

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
