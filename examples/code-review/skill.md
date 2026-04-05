---
name: realm-code-review
description: "Run a structured, evidence-tracked code review through Realm.
  Triggers on: 'review this code with realm', 'realm review', 'analyze code with realm'.
  Entry point: call start_run on the code-review workflow with params.code set to the code."
---

# Realm Code Review

When asked to review code with Realm:
1. Call `start_run` with `workflow_id: "code-review"` and `params: { code: "<the code>" }`.
2. Read `next_action.prompt` from the response — that is your complete task for this step.
3. Call `next_action.instruction.tool` with `instruction.params` (pre-filled by the engine) merged with
   any values listed in `instruction.params_required` (you must supply these). For agent steps the
   required param is `params` — your output shaped to `next_action.input_schema`.
4. Repeat from step 2 until `status` is `confirm_required` or `completed`.
5. On `confirm_required`: show `gate.prompt` to the user and wait for their reply.
   Call `submit_human_response` with `run_id`, `gate_id`, and `choice` set to the user's selection
   from `params_required[0].valid_values`.

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
