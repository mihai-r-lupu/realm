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
3. Call `next_action.instruction.tool` (which will be `execute_step`) with:
   - `step_name`: read from `next_action.instruction.params.step_name`
   - `input`: your output, matching the schema in `next_action.instruction.params.input_schema`
4. Repeat from step 2 until `status` is `confirm_required` or `completed`.
5. On `confirm_required`: show `gate.prompt` to the user and wait for their reply.
   Read `gate.gate_id` from the top-level `gate` field of the response.
   Call `submit_human_response` with that `gate_id` and the user's choice.
