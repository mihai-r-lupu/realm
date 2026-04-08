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

For a complete reference of all step fields, execution modes, transitions, and agent profiles, see [YAML Schema Reference](reference/yaml-schema.md).

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

Services let the engine fetch, create, or update data in external systems.

### Built-in: FileSystemAdapter

`@sensigo/realm` ships `FileSystemAdapter`, which reads a local file and returns
`{ content, path, line_count, size_bytes }`. No custom TypeScript required:

```typescript
import { ExtensionRegistry, FileSystemAdapter } from '@sensigo/realm';

const registry = new ExtensionRegistry();
registry.register('adapter', 'filesystem', new FileSystemAdapter('filesystem'));
```

```yaml
services:
  filesystem:
    adapter: filesystem
    trust: engine_delivered

steps:
  read_file:
    execution: auto
    uses_service: filesystem
    operation: read
    allowed_from_states: [created]
    produces_state: file_loaded
```

The file path is taken from the run's `params` — declare it in `params_schema` and pass it when
calling `start_run`. The step result is injected directly into the evidence; the agent cannot see
or alter it. See `examples/code-review/` and `examples/document-intake/` for working examples.

### Custom adapters

To fetch from any other source — an API, a database, a cloud service — implement `ServiceAdapter`
and register it the same way. Add the service declaration to `workflow.yaml`:

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
    prompt: |
      The following findings have been identified. Reply with 'approve' to accept or 'reject' to flag for re-review.
    instructions: |
      Present the display content to the user verbatim. Ask for their choice from gate.response_spec.choices,
      then call submit_human_response with run_id, gate_id, and choice.
    gate:
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

### Gate response fields

When the engine opens a gate, the `confirm_required` response includes a `gate` object:

- `gate.display` — the human-facing content resolved from `step.prompt`. Present this to the user verbatim before asking for their choice.
- `gate.agent_hint` — optional agent protocol instruction resolved from `step.instructions`. If present, the agent follows this to determine how to present the gate.
- `gate.response_spec.choices` — the valid choice values (e.g. `["approve", "reject"]`). Pass one of these as `choice` when calling `submit_human_response`.
- `gate.preview` — the full step output at point of gate opening, for reference and debugging.

**Authoring constraint:** keep `step.prompt` content bounded and human-readable — a concise summary, a count, or a short excerpt. Do not surface unbounded payloads (full document text, large JSON objects) as the gate display. Workflow authors are responsible for ensuring gate content remains manageable.

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

The agent has access to 7 MCP tools:

| Tool | Description |
|------|-------------|
| `list_workflows` | List all registered workflows |
| `get_workflow_protocol` | Get step-by-step instructions for a workflow |
| `start_run` | Start a new run |
| `execute_step` | Submit output for the current agent step |
| `submit_human_response` | Approve or reject a human gate |
| `get_run_state` | Inspect the current state of a run |
| `create_workflow` | Register a dynamic workflow at runtime and immediately start a run |

The agent should call `list_workflows` first to discover what is registered, then
`get_workflow_protocol` for the matched workflow before calling `start_run`. The protocol is
embedded in each workflow definition and provides exact instructions for what to do at each step.

### Mode 2: self-directed execution with `create_workflow`

When no pre-registered workflow matches the task, an agent can define its own multi-step plan at runtime:

```
create_workflow
  steps:
    - id: research_problem
      description: "Audit all JSDoc comments in the repository and list files with missing or inaccurate docs."
    - id: generate_fixes
      description: "For each file identified in the previous step, generate corrected JSDoc."
      input_schema:
        type: object
        properties:
          audit_summary: { type: string }
        required: [audit_summary]
  metadata:
    name: jsdoc-audit
    task_description: "Audit and fix JSDoc across the codebase."
```

`create_workflow` registers the workflow and starts a run in one call — no YAML file, no `realm register`. The response includes `data.workflow_id` and a `next_action` pointing at the first step. The agent then uses `execute_step` exactly as it would for a YAML workflow.

Runs created by `create_workflow` carry the same evidence chain, `next_action` guidance, and state machine enforcement as YAML-registered runs. See [`.github/instructions/realm-create-workflow.instructions.md`](../.github/instructions/realm-create-workflow.instructions.md) for the full protocol.

### Using multiple workflows

Realm supports any number of registered workflows in one store. To add more workflows:

```bash
realm register ./my-other-workflow
```

When the agent calls `list_workflows`, it receives the full list of registered IDs and names. It
matches the user's request to the right workflow ID, calls `get_workflow_protocol` to retrieve
that workflow's step-by-step briefing, then proceeds with `start_run`.

For VS Code, place a generic `.github/instructions/realm.instructions.md` in your repository
(see [examples/code-review/](../examples/code-review/)) — it teaches any connected agent the
full discovery-and-execute loop without being tied to a specific workflow.

For workflow-specific agent behaviour (custom trigger phrases, UX instructions, step-level
schemas), add a `skill.md` file alongside the workflow. The generic instructions and per-workflow
skill files compose cleanly: an agent trained on both knows both the Realm protocol and the
workflow-specific details.

For the full protocol — `next_action` fields, `chained_auto_steps`, `context_hint`, and error recovery — see [MCP Protocol Reference](reference/mcp-protocol.md).

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

---

## Next Steps

- Browse the [`examples/code-review/`](../examples/code-review/workflow.yaml) workflow for a realistic 3-step pattern with a service adapter, OWASP security review, and a human gate.
- Read the [YAML Schema Reference](reference/yaml-schema.md) for all step fields, execution modes, and transitions.
- Read the [MCP Protocol Reference](reference/mcp-protocol.md) for full tool and response envelope documentation.
- Read the [`@sensigo/realm` source](../packages/core/src/index.ts) for the full public API.