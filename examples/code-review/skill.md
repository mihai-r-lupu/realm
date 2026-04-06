---
name: realm-code-review
description: "Run a structured, evidence-tracked code review through Realm.
  Triggers on: 'review this file with realm', 'realm review', 'analyze code with realm'.
  Entry point: call start_run on the code-review workflow with params.path set to the absolute path of the file to review."
---

# Realm Code Review

When asked to review a file with Realm:
0. Optionally call `get_workflow_protocol` with `workflow_id: "code-review"` to see the full step
   graph and all step schemas before starting — useful if you want to plan your outputs upfront.
1. Call `start_run` with:
   `{ workflow_id: "code-review", params: { path: "/absolute/path/to/file.ts" } }`
   You do **not** need to read the file yourself — Realm reads it automatically via the registered
   filesystem adapter.
2. Read `next_action.prompt` from the response — that is your complete task for this step.
3. Call `next_action.instruction.tool` using `instruction.call_with` as the ready-to-use argument
   template — replace the placeholder(s) with your actual values, then call the tool.
   - `instruction.params_required` explains each placeholder (description, valid_values if applicable).
   - For agent steps: the required param is `params` — your output shaped to `next_action.input_schema`.
   - `review_security` expects: `{ findings: [{ severity, owasp_category, location, description, remediation }] }`
   - `assess_quality` expects: `{ findings: [{ category, description, suggestion, location }], overall_risk, summary }`
4. Repeat from step 2 until `status` is `confirm_required` or `completed`.
5. On `confirm_required`: show `gate.prompt` to the user and wait for their reply.
   If findings were already presented in the current conversation, open with
   "To confirm the above findings…" before asking for the choice — do not repeat the full findings list.
   `next_action.instruction` will be `{ tool: "submit_human_response", params: { run_id, gate_id }, params_required: [{ name: "choice", valid_values: [...] }] }`.
   Call `submit_human_response` with `run_id`, `gate_id`, and `choice` set to the user's selection
   from `gate.choices` (or `params_required[0].valid_values`).
   Use `next_action.instruction.call_with` as the ready-to-use argument template
   — replace the placeholder with the actual choice, then call the tool.

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
