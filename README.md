# Realm

**Certified AI Execution**

Realm is a workflow execution engine for AI agents that proves what your agent did. You define workflows in YAML. The engine enforces step order, validates every agent output against a JSON schema, captures tamper-evident evidence at each step, and pauses at human gates until a person approves. An AI agent connected via MCP cannot skip steps, produce malformed output, or proceed past a gate without authorization.

The result is not just a log of what ran — it is a cryptographically verifiable record that every step ran correctly. For developers building AI workflows for clients, that record is the deliverable.

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `@sensigo/realm` | [![npm](https://img.shields.io/npm/v/@sensigo/realm)](https://www.npmjs.com/package/@sensigo/realm) | Core engine — state guard, execution loop, evidence capture |
| `@sensigo/realm-cli` | [![npm](https://img.shields.io/npm/v/@sensigo/realm-cli)](https://www.npmjs.com/package/@sensigo/realm-cli) | `realm` CLI — 11 commands for building and operating workflows |
| `@sensigo/realm-mcp` | [![npm](https://img.shields.io/npm/v/@sensigo/realm-mcp)](https://www.npmjs.com/package/@sensigo/realm-mcp) | `realm-mcp` MCP server — 7 tools for AI agent connections |
| `@sensigo/realm-testing` | [![npm](https://img.shields.io/npm/v/@sensigo/realm-testing)](https://www.npmjs.com/package/@sensigo/realm-testing) | Testing utilities — fixtures, assertions, in-memory store |

## Installation

**CLI (global)**

```bash
npm install -g @sensigo/realm-cli
```

**MCP server (global, for AI agent connections)**

```bash
npm install -g @sensigo/realm-mcp
```

**Programmatic use**

```bash
npm install @sensigo/realm
```

**Testing utilities**

```bash
npm install --save-dev @sensigo/realm-testing
```

## Quick Start

### 1. Scaffold a workflow

```bash
realm init my-workflow
```

This creates `my-workflow/` with `workflow.yaml`, `schema.json`, `.env.example`, and a `README.md`.

### 2. Edit `my-workflow/workflow.yaml`

```yaml
id: my-workflow
name: "My Workflow"
version: 1
initial_state: created

steps:
  gather_input:
    description: "Agent collects the required information"
    execution: agent
    allowed_from_states: [created]
    produces_state: input_ready
    input_schema:
      type: object
      required: [summary]
      properties:
        summary:
          type: string

  finalize:
    description: "Human reviews and approves"
    execution: auto
    trust: human_confirmed
    allowed_from_states: [input_ready]
    produces_state: completed
```

### 3. Validate, register, and run

```bash
realm validate ./my-workflow   # check the YAML
realm register ./my-workflow   # register with the local store
realm run ./my-workflow        # run interactively (development mode)
```

`realm run` drives the workflow step by step, prompting you for simulated agent output and pausing at human gates.

## Connect an AI Agent via MCP

Start the MCP server:

```bash
realm-mcp
```

Or with `npx` without a global install:

```bash
npx @sensigo/realm-mcp
```

**Claude Desktop — `claude_desktop_config.json`**

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm-mcp"
    }
  }
}
```

**Cursor — `~/.cursor/mcp.json`**

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm-mcp"
    }
  }
}
```

Once connected the agent has access to 7 tools: `list_workflows`, `get_workflow_protocol`, `start_run`, `execute_step`, `submit_human_response`, `get_run_state`, and `create_workflow`.

The agent calls `list_workflows` to discover registered workflows, then `get_workflow_protocol` for the matched workflow to receive explicit step-by-step instructions. It cannot execute a step out of order or submit output that fails schema validation.

When no registered workflow matches the task, the agent calls `create_workflow` with a `steps` array to register a dynamic workflow and immediately start a run — no YAML file or `realm register` required. The run proceeds identically to a YAML workflow from that point.

**Multiple workflows:** register as many as you need with `realm register`. The agent discovers them all via `list_workflows` and picks the right one by ID. Add a `skill.md` alongside each workflow for workflow-specific agent behaviour.

## CLI Reference

| Command | Description |
|---------|-------------|
| `realm init <name>` | Scaffold a new workflow project directory |
| `realm validate <path>` | Validate a workflow YAML without registering it |
| `realm register <path>` | Register a workflow in the local store |
| `realm run <path>` | Run a workflow interactively (development mode) |
| `realm resume <run-id>` | Resume a paused run |
| `realm respond <run-id>` | Submit a response to a human gate |
| `realm inspect <run-id>` | Print the full evidence chain for a run |
| `realm replay <run-id>` | Re-evaluate preconditions with modified step outputs |
| `realm diff <run-a> <run-b>` | Compare evidence chains of two runs side by side |
| `realm cleanup` | Mark idle non-terminal runs as abandoned |
| `realm test <path>` | Run fixture-based tests against a workflow |

Run `realm <command> --help` for full options on any command.

## Writing a Custom Step Handler

A step handler contains business logic for an `auto` step. Register it before running the workflow.

```typescript
import type { StepHandler, StepHandlerInputs, StepContext, StepHandlerResult } from '@sensigo/realm';
import { ExtensionRegistry } from '@sensigo/realm';

const validateQuotes: StepHandler = {
  id: 'validate_verbatim_quotes',
  async execute(inputs: StepHandlerInputs, context: StepContext): Promise<StepHandlerResult> {
    const candidates = inputs.params['candidates'] as Array<{ verbatim_quote: string }>;
    const valid = candidates.filter(c => c.verbatim_quote.length > 0);
    return { data: { valid_count: valid.length, candidates: valid } };
  },
};

const registry = new ExtensionRegistry();
registry.register('handler', 'validate_verbatim_quotes', validateQuotes);
```

In `workflow.yaml`, reference it with `handler: validate_verbatim_quotes` on an `execution: auto` step.

## Built-in Service Adapters

`@sensigo/realm` ships `FileSystemAdapter` out of the box. Register it and reference it from any
`execution: auto` step to read a local file:

```typescript
import { ExtensionRegistry, FileSystemAdapter } from '@sensigo/realm';

const registry = new ExtensionRegistry();
registry.register('adapter', 'filesystem', new FileSystemAdapter('filesystem'));
```

The step receives `{ content, path, line_count, size_bytes }` with `trust: engine_delivered` —
the agent cannot see or alter the file content. See `examples/code-review/` for a working example.

See [docs/getting-started.md](docs/getting-started.md) for a complete end-to-end walkthrough including service adapters and MCP integration.

## Testing Workflows

Write fixture files describing a run's steps and expected outcomes, then run:

```bash
realm test ./my-workflow --fixtures ./my-workflow/fixtures/
```

In code, use `@sensigo/realm-testing` for unit-level assertions:

```typescript
import { InMemoryStore, assertFinalState, assertStepOutput } from '@sensigo/realm-testing';

// assertFinalState(runRecord, 'completed')
// assertStepOutput(runRecord, 'gather_input', { summary: 'approved' })
```

Full API: `InMemoryStore`, `MockServiceRecorder`, `createAgentDispatcher`, `createGateResponder`, `assertFinalState`, `assertStepSucceeded`, `assertStepFailed`, `assertStepOutput`, `assertEvidenceHash`, `testStepHandler`, `testProcessor`, `testAdapter`.

## Realm Cloud

The open source CLI and MCP server run entirely locally, with no cloud dependency.

[Realm Cloud](https://app.realm.dev) adds a hosted run history dashboard, cross-run analytics, scheduled workflow triggers, and the **Workflow Player UI** — a simple web interface that lets clients trigger runs, fill human gate prompts, and view their audit trail without needing an AI agent or MCP setup.

| Plan | Price | For |
|------|-------|-----|
| Solo | $29/month | Developers running workflows for their own projects |
| Builder | $79/month | Developers delivering AI workflows to clients — manage up to 5 client workspaces, invite clients to their own dashboard, export certified run reports |
| Client Workspace | $19/month | End clients operating a delivered workflow day-to-day |
| Enterprise | Custom | SSO, VPC/self-hosted, SOC2 evidence packages, SLA |

30-day free trial, no credit card required. [Start free →](https://app.realm.dev)

Building with Realm for a funded startup? [Apply to the startup program](https://realm.dev/startups) for 6 months free on Builder.

## Development

**Prerequisites:** Node.js 20+, npm 10+

```bash
npm install          # install all workspace dependencies
npm run build        # compile all packages
npm run test         # run all tests (301 total)
npm run lint         # lint all packages
```

## License

MIT
