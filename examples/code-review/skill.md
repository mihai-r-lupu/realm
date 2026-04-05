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
3. Execute the task, submit your output via the tool named in `next_action.instruction.tool`.
4. Repeat from step 2 until `status` is `confirm_required` or `completed`.
5. On `confirm_required`: show `gate.prompt` to the user and wait for their reply.
   Then call `submit_human_response` with `gate_id` and their choice.
