---
applyTo: "**"
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

Read `next_action.prompt` — that is your complete task for this step. `context_hint` at the top
level names the current run state and what just happened — use it for orientation on every
response, including errors where `next_action` is null.

Call `next_action.instruction.tool` using `instruction.call_with` as the ready-to-use argument
template — replace the placeholder(s) with your actual values, then call the tool.

- For agent steps: supply your work output in `params`, shaped to `next_action.input_schema`.
- `next_action.orientation` describes the current state and what step comes next.

### 5. Repeat until done

Repeat from step 4 until:
- `status` is `confirm_required` — a human gate is open; handle it in step 6, then continue.
- `status` is `ok` and `next_action` is `null` — the workflow has finished. No further steps exist.

### 6. Human gate (`status: confirm_required`)

1. Read `gate.agent_hint` for instructions on how to present the gate (if set).
2. Present `gate.display` to the user verbatim.
3. Collect the user's choice from `gate.response_spec.choices`.
4. Call `submit_human_response` using `next_action.instruction.call_with` with the choice filled in.

## Error and Blocked Responses

Every `status: 'error'` and `status: 'blocked'` response carries `agent_action` that tells you
what to do next. Do not parse the `errors` text to decide recovery strategy — use `agent_action`.

| `agent_action` | Meaning | What to do |
|---|---|---|
| `stop` | The run is terminal or has failed unrecoverably. | Do not retry. Report to user. |
| `report_to_user` | Engine state is inconsistent (e.g. snapshot mismatch). | Surface to user. Do not retry autonomously. |
| `provide_input` | The params you submitted were invalid. | Fix the params and retry `execute_step` with the same command. `next_action` shows the correct tool call. |
| `resolve_precondition` | A prior step must complete before this one. | Follow `next_action` if non-null, or check `blocked_reason` for allowed states. |
| `wait_for_human` | A human gate is open and waiting for a choice. | Call `submit_human_response` with the user's choice. |

When `agent_action` is `provide_input` or `resolve_precondition` and `next_action` is non-null,
follow it exactly as you would after a successful step. When `next_action` is null, surface
`blocked_reason` to the user.
