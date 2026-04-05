---
applyTo: "**"
---

# Realm Code Review

## Prerequisites

Before starting, confirm the `realm-code-review` MCP server is connected:
- Open the Chat view and check that the Realm tools appear in the tool list.
- If not, run **MCP: List Servers** from the Command Palette, start the server, then open a new chat session.

## Protocol

When asked to review code with Realm:
1. Call `start_run` with `workflow_id: "code-review"` and `params: { code: "<the code>" }`.
2. Read `next_action.prompt` from the response — that is your complete task for this step.
   `context_hint` at the top level names the current run state and what just happened —
   use it for orientation on every response, including errors where `next_action` is null.
3. Call `next_action.instruction.tool` with the params from `next_action.instruction.params`.
   - `instruction.params` contains pre-filled values — pass them as-is.
   - `instruction.call_with` is the ready-to-use argument template. Replace the
     placeholder string(s) (e.g. `<YOUR_PARAMS>`, `<approve|reject>`) with your
     actual values, then call the tool with the resulting object.
   - `instruction.params_required` lists the params you must supply — use this to
     understand what each placeholder expects (description, valid_values if applicable).
   - For agent steps: the tool is `execute_step`. `params_required` will contain `{ name: "params" }` — supply your work output there, shaped according to `next_action.input_schema`.
   - Example: `execute_step({ run_id: "...", command: "review_security", params: { findings: [...] } })`
4. Repeat from step 2 until `status` is `confirm_required` or `completed`.
5. On `confirm_required`: show `gate.prompt` to the user and wait for their reply.
   `next_action.instruction` will be `{ tool: "submit_human_response", params: { run_id, gate_id }, params_required: [{ name: "choice", valid_values: [...] }] }`.
   Call `submit_human_response` with `run_id`, `gate_id`, and `choice` set to the user's selection from `gate.choices` (or `params_required[0].valid_values`).

## Error and Blocked Responses

Every `status: 'error'` and `status: 'blocked'` response carries `agent_action` that tells you what to do next. Do not parse the `errors` text to decide recovery strategy — use `agent_action`.

| `agent_action` | Meaning | What to do |
|---|---|---|
| `stop` | The run is terminal or has failed unrecoverably. | Do not retry. Report to user. |
| `report_to_user` | Engine state is inconsistent (e.g. snapshot mismatch). | Surface to user. Do not retry autonomously. |
| `provide_input` | The params you submitted were invalid. | Fix the params and retry `execute_step` with the same command. `next_action` shows the correct tool call. |
| `resolve_precondition` | A prior step must complete before this one. | Follow `next_action` if non-null, or check `blocked_reason` for allowed states. |
| `wait_for_human` | A human gate is open and waiting for a choice. | Call `submit_human_response` with the user's choice. |

When `agent_action` is `provide_input` or `resolve_precondition` and `next_action` is non-null, follow it exactly as you would after a successful step. When `next_action` is null, surface `blocked_reason` to the user.
