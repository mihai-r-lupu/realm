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
   - For agent steps, the tool is `execute_step` and params include `run_id` and `command` (already populated — pass them as-is).
   - The step's expected input schema is at `next_action.input_schema` — use it to structure the `params` argument of your `execute_step` call.
   - Example: `execute_step({ run_id: "...", command: "review_security", params: { findings: [...] } })`
4. Repeat from step 2 until `status` is `confirm_required` or `completed`.
5. On `confirm_required`: show `gate.prompt` to the user and wait for their reply.
   `next_action.instruction` will be `{ tool: "submit_human_response", params: { run_id, gate_id } }`.
   Call `submit_human_response` with the `run_id`, `gate_id`, and the user's choice string from `gate.choices`.
