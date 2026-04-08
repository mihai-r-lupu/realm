# YAML Schema Reference

Complete reference for `workflow.yaml` fields. Every field documented here is validated at `realm register` time — errors include the field name and expected type.

---

## Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique workflow identifier. Used in all CLI commands and MCP tool calls. |
| `name` | string | Yes | Human-readable workflow name. |
| `version` | integer | Yes | Workflow version number. Incremented on each `realm register`. |
| `initial_state` | string | Yes | State every new run starts in. Must appear in at least one step's `allowed_from_states`. |
| `params_schema` | object | No | JSON Schema for the params accepted by `start_run`. The agent's `call_with.params` skeleton is derived from this at runtime. |
| `services` | object | No | Named service definitions. Referenced by steps via `uses_service`. |
| `steps` | object | Yes | Map of step name → step definition. |
| `protocol` | object | No | Optional protocol customisations. See [Protocol](#protocol-customisation). |
| `profiles_dir` | string | No | Path to agent profile files, relative to the workflow YAML. Defaults to `agents/` in the same directory. |

---

## Step fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | Human-readable step description. Appears in the agent protocol. |
| `execution` | `agent` \| `auto` | Yes | Who executes this step. |
| `allowed_from_states` | string[] | Yes | Run states from which this step may execute. The engine blocks any attempt from a state not in this list. |
| `produces_state` | string | Yes | State the run transitions to after this step completes. Must be unique across all steps. |
| `uses_service` | string | No | Name of a service declared in `services`. Only valid on `execution: auto` steps. |
| `service_method` | `fetch` \| `create` \| `update` | No | Adapter method to call. Defaults to `fetch`. |
| `operation` | string | No | Operation name passed to the adapter. Defaults to the step name. |
| `handler` | string | No | Name of a registered `StepHandler` to invoke. Only valid on `execution: auto` steps. |
| `input_schema` | object | No | JSON Schema validated against the agent's submitted `params` before execution. |
| `preconditions` | string[] | No | Boolean expressions evaluated before the step runs. See [Preconditions](#preconditions). |
| `trust` | string | No | Human oversight level. See [Trust levels](#trust-levels). |
| `timeout_seconds` | integer | No | Step execution timeout in seconds. On expiry the run fails with `STEP_TIMEOUT`. |
| `retry` | object | No | Retry configuration. See [Retry](#retry). |
| `instructions` | string | No | Agent-facing instructions. Delivered as `gate.agent_hint` when a gate is open. |
| `prompt` | string | No | Template-resolved task prompt delivered via `next_action.prompt`. On human gate steps, delivered as `gate.display`. Supports `{{ context.resources.STEP.FIELD }}` and `{{ run.params.FIELD }}`. |
| `gate` | object | No | Gate configuration. `gate.choices` lists the valid human response values. |
| `transitions` | object | No | Conditional routing. See [Transitions](#transitions). |
| `agent_profile` | string | No | Agent profile name. Only valid on `execution: agent` steps. Must match a file in `profiles_dir`. |

---

## Execution modes

### `execution: agent`

The engine pauses and returns `next_action` pointing at this step. The AI agent (or `realm run` in dev mode) calls `execute_step` with the step's `command` and `params`. The engine validates `params` against `input_schema` before proceeding.

### `execution: auto`

The engine executes this step immediately without returning to the caller. If the step declares `uses_service`, the engine calls the registered adapter. If it declares `handler`, the engine calls the registered `StepHandler`. Auto steps chain automatically: after any step completes, if the next step is `auto`, the engine runs it immediately and repeats until it reaches an agent step, a human gate, or a terminal state.

---

## Trust levels

| Value | Description |
|-------|-------------|
| `auto` | No human involvement. The engine executes and advances. Default. |
| `human_notified` | The human is informed but not required to act. |
| `human_confirmed` | The engine pauses and returns `status: confirm_required`. The run will not advance until `submit_human_response` is called with a valid gate choice. |
| `human_reviewed` | The human must demonstrate review via challenge before the gate can close. |

`trust` is only meaningful on `execution: auto` steps — an agent step already requires an explicit `execute_step` call.

---

## Transitions

Transitions declare conditional routing for `execution: auto` steps. When a transition fires, the engine routes the run to a named step and state instead of the step's default `produces_state`.

### `on_error`

When the step's handler throws, the engine demotes the error to a `warnings` entry, transitions the run to the branch state, and continues from the branch step. The caller receives `status: ok`.

```yaml
validate_fields:
  execution: auto
  handler: validate_fields
  allowed_from_states: [fields_extracted]
  produces_state: validated
  transitions:
    on_error:
      step: extract_fields
      produces_state: revision_requested
```

`on_error` is only valid on `execution: auto` steps.

### Gate-response keys (`on_<choice>`)

On a step with `trust: human_confirmed`, each gate choice can route to a different branch. The key must be `on_` followed by a value from `gate.choices`.

```yaml
confirm_submission:
  execution: auto
  trust: human_confirmed
  allowed_from_states: [validated]
  produces_state: submitted
  gate:
    choices: [approve, reject]
  transitions:
    on_reject:
      step: extract_fields
      produces_state: revision_requested
```

---

## Preconditions

Boolean expressions evaluated against prior step evidence before the step runs. If any precondition is false, the engine returns `status: blocked` with `agent_action: resolve_precondition`.

```yaml
write_to_target:
  execution: auto
  preconditions:
    - "validate_fields.result.accepted_count > 0"
```

Supported operators: `>`, `<`, `>=`, `<=`, `==`, `!=`. The left side is a dot-path into the evidence of a prior step (`step.result.field`). The right side is a literal value.

---

## Retry

```yaml
fetch_document:
  execution: auto
  uses_service: source
  retry:
    max_attempts: 3
    backoff: exponential
    base_delay_ms: 1000
```

| Field | Type | Description |
|-------|------|-------------|
| `max_attempts` | integer | Total attempts including the first. |
| `backoff` | `linear` \| `exponential` \| `fixed` | Delay growth strategy. |
| `base_delay_ms` | integer | Base delay in milliseconds. |

---

## Services

```yaml
services:
  source:
    adapter: google_docs
    auth:
      token_from: secrets.GDOCS_TOKEN
    trust: engine_delivered
```

| Field | Type | Description |
|-------|------|-------------|
| `adapter` | string | Name of a registered `ServiceAdapter`. |
| `auth.token_from` | string | Secret key path. Resolved at runtime from the loaded secrets. |
| `trust` | string | Service trust level. See below. |

### Service trust levels

| Value | Description |
|-------|-------------|
| `engine_delivered` | Service response is injected directly into evidence. The agent cannot see or alter it. |
| `engine_managed` | The engine manages the service call; the agent provides input parameters. |
| `agent_provided` | The agent is responsible for the service interaction. |

---

## Agent profiles

An `execution: agent` step can declare a reusable persona:

```yaml
profiles_dir: agents   # relative to workflow YAML; this is also the default

steps:
  review_security:
    execution: agent
    agent_profile: security-reviewer   # loads agents/security-reviewer.md
```

The profile file must exist in `profiles_dir`. If it is missing, `realm register` fails immediately and includes the expected file path in the error message. The profile content is delivered to the agent as `agent_profile_instructions` on the protocol step. Its SHA-256 hash is recorded in the evidence snapshot for auditability.

---

## Prompt templates

The `prompt` field supports template references resolved at runtime:

| Syntax | Resolves to |
|--------|-------------|
| `{{ context.resources.STEP.FIELD }}` | Value of `FIELD` in the evidence output of `STEP` |
| `{{ run.params.FIELD }}` | Value of `FIELD` in the run's `params` |

Unresolved references are left as literal strings.

---

## Protocol customisation

```yaml
protocol:
  quick_start: "Call start_run with workflow_id 'my-workflow'..."
  rules:
    - "Always confirm with the user before writing to the target system."
```

`quick_start` overrides the generated instructions paragraph in `get_workflow_protocol`. `rules` replaces the default rule set entirely — include the defaults if you still want them.
