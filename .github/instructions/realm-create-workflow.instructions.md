---
applyTo: '**'
---

# Realm: Using create_workflow

This file teaches you how to define and track autonomous multi-step plans through
Realm's execution engine using the `create_workflow` MCP tool.

If you have read `realm.instructions.md`, you already know the step loop: `execute_step`
advances a run, each response has `next_action`, and `agent_action` tells you how to recover
from errors. This file covers the `create_workflow` entry point, which replaces `start_run`
when no registered workflow matches your task.

If you have not read `realm.instructions.md`, the essential context is: Realm is a workflow
execution engine. Runs proceed step-by-step. Each step response carries `next_action`, which
gives you the exact tool call for the next step. Read `realm.instructions.md` alongside this
file for the full step-loop protocol.

## When to Use create_workflow

Use `create_workflow` when:

- The user asks you to perform an autonomous multi-step task.
- `list_workflows` returns no registered workflow that matches the task.
- You need structured step-by-step tracking and want intermediate outputs recorded.

Do **not** use `create_workflow` when a registered workflow already exists — use `start_run`
instead.

## How to Call create_workflow

`create_workflow` registers the workflow and starts a run in a single call. Do **not** call
`start_run` afterward — the run is already live when `create_workflow` returns.

Minimal call:

```json
{
  "steps": [
    {
      "id": "research_company",
      "description": "Find the company's recent news, product offerings, and known engineering challenges."
    },
    {
      "id": "draft_proposal",
      "description": "Write a one-page proposal addressing the challenges found in the research step.",
      "input_schema": {
        "type": "object",
        "properties": {
          "company_summary": { "type": "string" }
        },
        "required": ["company_summary"]
      }
    }
  ],
  "metadata": {
    "name": "acme-proposal",
    "task_description": "Research Acme Corp and draft a proposal for them."
  }
}
```

**Parameters:**

| Field                       | Required | Description                                                |
| --------------------------- | -------- | ---------------------------------------------------------- |
| `steps`                     | Yes      | Array of step objects. At least one step required.         |
| `metadata.name`             | No       | Short slug used to derive the workflow ID. Use kebab-case. |
| `metadata.task_description` | No       | Human-readable description of the overall task.            |

Each step:

| Field             | Required | Description                                                 |
| ----------------- | -------- | ----------------------------------------------------------- |
| `id`              | Yes      | Unique identifier. Snake_case verb-noun. No spaces.         |
| `description`     | Yes      | What a correct output looks like (acceptance criterion).    |
| `input_schema`    | No       | JSON Schema for the fields this step's output must include. |
| `depends_on`      | No       | Advisory list of step IDs this step logically follows.      |
| `timeout_seconds` | No       | Positive integer. If omitted, no timeout is enforced.       |

## Step Design Guidelines

### 1. One concrete deliverable per step

Each step should produce exactly one output that a downstream step or the user can act on
directly. If you would describe a step as "do X and then Y", split it into two steps.

### 2. `id` is verb-noun snake_case

Name steps as actions: `research_company`, `draft_proposal`, `review_output`. Not `step_1`,
`task_a`, or the bare noun `research`. IDs are recorded permanently once the run starts.

### 3. `description` is the acceptance criterion, not the method

Write what a correct output looks like. "Find the company's recent news, product offerings, and
known engineering challenges" is an acceptance criterion. "Use the web search tool to look up the
company" is a method — avoid it.

### 4. `input_schema` captures only downstream dependencies

Define fields only for data that later steps or the user will consume. Do not schema every
intermediate thought. One or two fields is normal. More than five suggests the step is doing
too much.

### 5. `depends_on` is advisory — but validated

The engine always runs steps in array order. Setting `depends_on` expresses logical
dependencies for clarity but does not change execution order. Omit it when array order makes
the sequence obvious.

All IDs listed in `depends_on` must refer to steps that appear **earlier** in the `steps` array
(no forward references). Violating this causes `create_workflow` to return
`agent_action: 'provide_input'` — fix the array order or remove the invalid reference.

## After Calling create_workflow

The response is a `ResponseEnvelope` in the same shape as a `start_run` response. The run has
already started — check `next_action` immediately and proceed to `execute_step`:

```json
{
  "status": "ok",
  "run_id": "<assigned-run-id>",
  "data": { "workflow_id": "acme-proposal-a1b2c3" },
  "next_action": {
    "prompt": "Your task for the first step...",
    "instruction": {
      "tool": "execute_step",
      "call_with": {
        "run_id": "<assigned-run-id>",
        "command": "research_company",
        "params": {}
      }
    }
  }
}
```

Call `execute_step` using `instruction.call_with` as the template — fill in your step output
in `params` (shaped to `next_action.input_schema` if present). The engine does not require a
`snapshot_id` argument — it reads the current version from the store automatically.

The step loop from this point is identical to Mode 1: read `next_action.prompt`, do the work,
call `execute_step` with your output in `params`, and repeat. Stop when `status` is
`confirm_required` (human gate — see `realm.instructions.md` step 6) or when `status` is `ok`
and `next_action` is `null` (workflow finished). Error responses carry `agent_action` — handle
them as described in `realm.instructions.md`.

## Constraints

- `agent_profile` is not supported on dynamically-created workflows. If a step includes it,
  `create_workflow` returns `agent_action: 'provide_input'`. Remove the field and retry.
- Step IDs must be unique, non-empty, and contain no spaces.
- Step descriptions must be non-empty.
- `timeout_seconds` must be a positive integer if set.
- All steps in a dynamic workflow are `execution: agent` — the engine always returns them to
  you for execution. `handler:` and `uses_service:` are not available on dynamic steps; use
  a YAML-registered workflow if you need auto steps, service adapters, or handlers.
- `depends_on` references must point to steps earlier in the array. Forward references cause
  a `provide_input` error at `create_workflow` call time.
