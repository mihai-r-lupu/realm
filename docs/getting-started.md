# Getting Started with Realm

This guide walks through building, running, and testing a Realm workflow from scratch.

**Time to complete:** ~10 minutes  
**Prerequisites:** Node.js 20+, npm 10+

---

## 1. Install the CLI

```bash
npm install -g @sensigo/realm-cli
```

Verify the install:

```bash
realm --version
```

---

## 2. Scaffold a Workflow

```bash
realm init extraction-demo
cd extraction-demo
```

This creates:

```
extraction-demo/
  workflow.yaml    # workflow definition
  schema.json      # optional shared params schema
  .env.example     # secrets template
  README.md        # project readme
```

---

## 3. Understand the Workflow Definition

Open `workflow.yaml`. The key fields are:

```yaml
id: extraction-demo          # unique identifier used in all CLI commands
name: "Extraction Demo"
version: 1
initial_state: created       # every run starts here

steps:
  step_one:
    description: "..."
    execution: agent          # the AI agent executes this step
    allowed_from_states: [created]
    produces_state: step_one_done
    input_schema:             # the engine validates agent output against this schema
      type: object
      required: [result]
      properties:
        result:
          type: string

  finalize:
    execution: auto           # engine executes this automatically
    allowed_from_states: [step_one_done]
    produces_state: completed
```

`execution: agent` — the step waits for the AI agent (or `realm run` in dev mode) to call `execute_step`.  
`execution: auto` — the engine runs this step immediately, optionally calling a registered `handler`.  
`trust: human_confirmed` — the engine pauses and waits for `submit_human_response` before advancing.

---

## 4. Validate and Register

```bash
realm validate ./                # parse and validate the YAML
realm register ./                # store the workflow definition locally
```

`realm validate` catches schema errors, duplicate step IDs, and invalid state transitions before you run anything.

---

## 5. Run Interactively

```bash
realm run ./
```

`realm run` is a development driver. For each agent step it prompts you to type the JSON output. For human gates it prompts for approval. This lets you exercise the full workflow without an AI agent.

Example session:

```
Step: step_one — Collect the required information
Enter agent output (JSON): {"result": "the document text"}

Step: finalize — Human reviews and approves
Approve? [y/n]: y

Run completed. Final state: completed
Run ID: abc123
```

---

## 6. Inspect the Evidence Chain

```bash
realm inspect abc123
```

Every step produces a tamper-evident evidence record containing the input received, the output produced, the resulting state, and a SHA-256 hash of the full evidence chain up to that point.

---

## 7. Adding a Service

Services let the engine fetch, create, or update data in external systems. Add one to `workflow.yaml`:

```yaml
services:
  source:
    adapter: google_docs
    auth:
      token_from: secrets.GDOCS_TOKEN
    trust: engine_delivered

steps:
  fetch_document:
    execution: auto
    uses_service: source
    allowed_from_states: [created]
    produces_state: document_ready
```

When `trust: engine_delivered` is set, the agent cannot see or alter the service response — the engine injects it directly into the step's evidence.

Implement the adapter in TypeScript and register it with `ExtensionRegistry`:

```typescript
import type { ServiceAdapter, ServiceResponse } from '@sensigo/realm';
import { ExtensionRegistry } from '@sensigo/realm';

const googleDocsAdapter: ServiceAdapter = {
  id: 'google_docs',
  async fetch(_operation, _params, config): Promise<ServiceResponse> {
    const token = config['token'] as string;
    // call the Google Docs API …
    return { status: 200, data: { text: '…' } };
  },
  async create(_op, _p, _c) { return { status: 501, data: {} }; },
  async update(_op, _p, _c) { return { status: 501, data: {} }; },
};

const registry = new ExtensionRegistry();
registry.register('adapter', 'google_docs', googleDocsAdapter);
```

---

## 8. Adding a Human Gate

A human gate pauses a run and requires explicit approval before the engine advances to the next step. Add one to `workflow.yaml`:

```yaml
steps:
  review_findings:
    description: "Security team reviews the identified findings."
    execution: auto
    trust: human_confirmed
    allowed_from_states: [findings_ready]
    produces_state: findings_approved
    gate:
      preview: "{{ steps.collect_findings.output.summary }}"
      choices:
        - approve
        - reject
```

When the engine reaches a step with `trust: human_confirmed`, it pauses the run and returns `status: confirm_required`. The run will not advance until a human responds.

**To resume a paused run from the CLI:**

```bash
realm respond <run-id>
```

**To resume via the MCP tool:** call `submit_human_response` with the `run_id`, `gate_id`, and `choice` from the `confirm_required` response.

### The `gate.preview` field

`gate.preview` is a Jinja-style template resolved when the gate opens. Its resolved value is sent inline in the response and is what the human sees when deciding whether to approve or reject. It must be a bounded, human-readable summary — not raw agent output.

**Authoring constraint:** the preview is sent to the agent and forwarded to the human. It must contain only the information needed to make the decision: a concise summary, a count, or a short excerpt. Do not surface unbounded payloads — full document text, raw finding arrays, or large JSON objects — as the preview value. Workflow authors are responsible for ensuring gate previews remain small.

---

## 9. Adding a Step Handler

A step handler contains business logic for an `auto` step — validation, transformation, enrichment.

```yaml
steps:
  validate_output:
    execution: auto
    handler: check_required_fields
    allowed_from_states: [fields_extracted]
    produces_state: validated
```

```typescript
import type { StepHandler, StepHandlerInputs, StepContext, StepHandlerResult } from '@sensigo/realm';

const checkRequiredFields: StepHandler = {
  id: 'check_required_fields',
  async execute(inputs: StepHandlerInputs, _ctx: StepContext): Promise<StepHandlerResult> {
    const fields = inputs.params['fields'] as Record<string, unknown>;
    const missing = ['name', 'date'].filter(k => !(k in fields));
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }
    return { data: { validated: true, fields } };
  },
};
```

---

## 10. Connect an AI Agent via MCP

Install the MCP server:

```bash
npm install -g @sensigo/realm-mcp
```

Start it:

```bash
realm-mcp
```

Configure your AI client. **Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm-mcp"
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm-mcp"
    }
  }
}
```

The agent has access to 6 MCP tools:

| Tool | Description |
|------|-------------|
| `list_workflows` | List all registered workflows |
| `get_workflow_protocol` | Get step-by-step instructions for a workflow |
| `start_run` | Start a new run |
| `execute_step` | Submit output for the current agent step |
| `submit_human_response` | Approve or reject a human gate |
| `get_run_state` | Inspect the current state of a run |

The agent should call `get_workflow_protocol` first. The protocol is embedded in the workflow definition and provides exact instructions for what to do at each step.

Every `start_run` and `execute_step` response includes a `next_action` object. The agent reads
`next_action.prompt` for its current task, then calls `next_action.instruction.tool` with the
complete argument set built from two disjoint sources:

- `instruction.params` — values pre-filled by the engine (e.g. `run_id`, `command`). Pass these as-is.
- `instruction.params_required` — parameters the agent must supply (e.g. its output for the step,
  or a human gate `choice`). Each entry has a `name`, a `description`, and optionally `valid_values`.

For agent steps, `params_required` will contain `{ name: "params" }` — the agent's output shaped to
`next_action.input_schema`. For human gate responses, it will contain
`{ name: "choice", valid_values: [...] }` listing the allowed choices.

### Error and blocked responses

Every `status: 'error'` and `status: 'blocked'` response includes an `agent_action` field that
tells the agent how to recover — without requiring it to parse the error message text.

| `agent_action` | Meaning | What to do |
|---|---|---|
| `stop` | Terminal failure. | Do not retry. Report to user. |
| `report_to_user` | Engine state inconsistent (e.g. snapshot mismatch). | Surface to user. Do not retry autonomously. |
| `provide_input` | Submitted params were invalid. | Fix params and retry `execute_step` with the same command. Use `next_action` for the correct call. |
| `resolve_precondition` | Wrong step for current state. | Follow `next_action` to the correct step, or check `blocked_reason` for allowed states. |
| `wait_for_human` | Gate is open. | Call `submit_human_response` with the user's choice. |

When `agent_action` is `provide_input` or `resolve_precondition` and `next_action` is non-null,
follow it exactly as after a successful step.

---

## 11. Testing Workflows

Write a fixture file in `extraction-demo/fixtures/happy-path.yaml`:

```yaml
workflow: extraction-demo
description: "Complete happy-path run"
params: {}
steps:
  step_one:
    output:
      result: "the document text"
  finalize:
    gate_response:
      approved: true
expected_final_state: completed
```

Run the tests:

```bash
realm test ./ --fixtures ./fixtures/
```

In unit tests, use `@sensigo/realm-testing`:

```typescript
import { InMemoryStore, createAgentDispatcher, assertFinalState, assertStepOutput } from '@sensigo/realm-testing';
import { executeChain } from '@sensigo/realm';

const store = new InMemoryStore();
const dispatch = createAgentDispatcher({ step_one: { result: 'the document text' } });

const run = await store.create({ workflowId: 'extraction-demo', params: {} });
await executeChain({ definition, run, store, dispatch });

assertFinalState(run, 'completed');
assertStepOutput(run, 'step_one', { result: 'the document text' });
```

---

## 12. Other Useful Commands

```bash
realm resume <run-id>             # resume a paused run
realm respond <run-id>            # submit a human gate response
realm replay <run-id>             # re-evaluate preconditions with overrides
realm diff <run-a> <run-b>        # compare evidence chains of two runs
realm cleanup --older-than 30d    # abandon runs idle for 30+ days
```

---

## Next Steps

- Browse the example workflow in [`workflows/playbook-extraction/`](../workflows/playbook-extraction/workflow.yaml) for a realistic 4-step pattern.
- Read the [`@sensigo/realm` source](../packages/core/src/index.ts) for the full public API.
