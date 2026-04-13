---
applyTo: '**'
---

# Realm Workflows

Realm is a workflow execution engine accessible via MCP. When a user asks you to run a Realm
workflow — or triggers one by name — follow this protocol.

## Setup Check

Before starting, confirm the Realm MCP server is connected:

- Open the Chat view and verify the Realm tools appear in the tool list.
- If not, run **MCP: List Servers** from the Command Palette, start the server, then open a new
  chat session.

## Protocol

### 1. Discover registered workflows

Call `list_workflows` to see all registered workflows and their IDs. Match the user's request to
a workflow ID from the results. If two workflows could fit, ask the user which one they want.

### 2. Get the workflow protocol

Call `get_workflow_protocol` with the matched `workflow_id`. This returns a full briefing: what
each step does, what you must execute, what the engine handles automatically, and the input schema
for each agent step. Read it before calling `start_run`.

### 3. Start the run

Call `start_run` with `workflow_id` and any required `params` (check `params_schema` in the
protocol). The engine may auto-chain through initial auto steps and return the first agent step
immediately.

### 4. Execute agent steps

Read `next_action.prompt` first — that is your complete task for this step. It is resolved from
the workflow's step definition at runtime and supersedes any static instructions you may have
about this workflow. `prompt` is optional; when absent, use `next_action.human_readable` instead
— it is always present and gives an equivalent agent-facing task description. `context_hint`
describes what just happened and the current run state — read it on every response, including errors.

Call the tool named in `next_action.instruction.tool` using `instruction.call_with` as the
ready-to-use argument template. For ordinary agent steps this is `execute_step`, but for handler
steps it will be the handler's own tool name — always use the value from the response, never
hardcode `execute_step`.

The `call_with` object is pre-populated with placeholders:

- When `input_schema` is present, `call_with.params` is already a skeleton object with the correct
  field names and type-appropriate defaults — fill in the values, do not reconstruct the shape.
- Enum fields appear as `<value1|value2|value3>` — replace with one of the listed values.
- Scalar fields appear as `0` or `""` — replace with your actual value.
- Arrays appear as `[]` — populate with your items.

`next_action.orientation` describes the current state and what step comes next (distinct from
`context_hint`, which describes what just happened).

If `next_action.expected_timeout` is set, the step has a declared timeout — complete within
the indicated time (e.g. `"30s"`).

### 5. Repeat until done

Repeat from step 4 until:

- `status` is `confirm_required` — a human gate is open; handle it in step 6, then continue.
- `status` is `ok` and `next_action` is `null` — the workflow has finished. No further steps exist.

### 5a. Reading `chained_auto_steps`

When `start_run`, `execute_step`, or `submit_human_response` triggers auto steps before returning,
`chained_auto_steps` records each one in order. The field is omitted entirely when no auto steps
ran — only present when the array would be non-empty:

```json
"chained_auto_steps": [
  { "step": "validate_fields", "produced_state": "validated" },
  { "step": "route_result", "produced_state": "revision_requested", "branched_via": "on_reject" }
]
```

`branched_via` is present when a transition fired — `on_error`, an `on_success` route key, or
`on_<choice>` from a gate response (e.g. `on_approve`, `on_reject`). Use this to understand which
path the engine took before returning to you.

### 5b. `status: ok` with warnings — recovery branch taken

**`status: ok` does not guarantee the original step succeeded.** When an `on_error` transition
fires, the engine demotes the error to a `warnings[]` entry, routes to the recovery branch step,
and returns `status: ok`. Always check `warnings` on `ok` responses — a non-empty array means a
recovery path was taken, and `context_hint` will describe what happened.

### 6. Human gate (`status: confirm_required`)

1. Read `gate.agent_hint` for instructions on how to present the gate (if set).
2. Present `gate.display` to the user verbatim. If `gate.display` is absent, construct a prompt
   from `gate.preview` — the step output awaiting human review.
3. Collect the user's choice from `gate.response_spec.choices`.
4. Call `submit_human_response` using `next_action.instruction.call_with` with:
   - `gate_id` from `gate.gate_id` (required — distinct from `run_id`)
   - `choice` set to the user's selected value from `gate.response_spec.choices`
5. After `submit_human_response` returns, check `chained_auto_steps` — the gate response may
   trigger an `on_<choice>` transition that chains through additional auto steps before returning
   the next agent step. The final state is always reflected in `next_action`.

## Checking Run State

If you lose track of a run's current state (e.g. after an error or session gap), call
`get_run_state` with the `run_id`. It returns the current state name, whether the run is
terminal, the pending gate if any, and how many evidence entries exist. Use it to orient
yourself before deciding the next tool call — do not guess the state.

## Error and Blocked Responses

Every `status: 'error'` and `status: 'blocked'` response carries `agent_action` that tells you
what to do next. Do not parse the `errors` text to decide recovery strategy — use `agent_action`.

| `agent_action`         | Meaning                                                | What to do                                                                                                |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `stop`                 | The run is terminal or has failed unrecoverably.       | Do not retry. Report to user.                                                                             |
| `report_to_user`       | Engine state is inconsistent (e.g. snapshot mismatch). | Surface to user. Do not retry autonomously.                                                               |
| `provide_input`        | The params you submitted were invalid.                 | Fix the params and retry `execute_step` with the same command. `next_action` shows the correct tool call. |
| `resolve_precondition` | Wrong step for current state.                          | Follow `next_action` if non-null to call the correct step instead.                                        |
| `wait_for_human`       | An external service is unavailable (network down, upstream 5xx). The run cannot continue until the dependency recovers. | Show the error to the user and wait for them to confirm the issue is resolved before retrying. |

When `agent_action` is `provide_input` or `resolve_precondition` and `next_action` is non-null,
follow it exactly as you would after a successful step. When `next_action` is null, surface
`blocked_reason.suggestion` to the user — it names the failed precondition or explains why no
valid next step exists.

### Precondition failures

When a step's preconditions are not met, the response is `status: blocked`, `agent_action: stop`,
`next_action: null`. The `blocked_reason.suggestion` field names which precondition expression
failed and its resolved value. You cannot recover autonomously — report to the user.
