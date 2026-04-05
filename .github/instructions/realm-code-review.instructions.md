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
3. Call `next_action.instruction.tool` with the params from `next_action.instruction.params`.
   - `instruction.params` contains pre-filled values — pass them as-is.
   - `instruction.params_required` lists params you must supply. Merge them with `instruction.params` to get the complete call arguments.
   - For agent steps: the tool is `execute_step`. `params_required` will contain `{ name: "params" }` — supply your work output there, shaped according to `next_action.input_schema`.
   - Example: `execute_step({ run_id: "...", command: "review_security", params: { findings: [...] } })`
4. Repeat from step 2 until `status` is `confirm_required` or `completed`.
5. On `confirm_required`: show `gate.prompt` to the user and wait for their reply.
   `next_action.instruction` will be `{ tool: "submit_human_response", params: { run_id, gate_id }, params_required: [{ name: "choice", valid_values: [...] }] }`.
   Call `submit_human_response` with `run_id`, `gate_id`, and `choice` set to the user's selection from `gate.choices` (or `params_required[0].valid_values`).
