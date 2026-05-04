# @sensigo/realm-cli

Run autonomous agent workflows, host an MCP server over HTTP, and manage workflow definitions and run history from the terminal.

## Installation

```
npm install -g @sensigo/realm-cli
```

## Commands

### realm workflow \<command\>

| Command    | Description                                           |
| ---------- | ----------------------------------------------------- |
| `init`     | Scaffold a new workflow directory                     |
| `validate` | Validate a workflow YAML file                         |
| `register` | Register a workflow from a directory                  |
| `watch`    | Watch a workflow directory and re-register on changes |
| `run`      | Start a workflow run                                  |
| `test`     | Run workflow tests                                    |
| `migrate`  | Apply schema migrations to stored runs                |

### realm run \<command\>

| Command   | Description                        |
| --------- | ---------------------------------- |
| `list`    | List all runs                      |
| `inspect` | Inspect a run's steps and evidence |
| `replay`  | Replay a completed run             |
| `diff`    | Diff two run records               |
| `resume`  | Resume a paused run                |
| `respond` | Submit a response to a human gate  |
| `cleanup` | Delete old or terminal runs        |

### Top-level commands

| Command | Description                                |
| ------- | ------------------------------------------ |
| `mcp`   | Start the MCP server over stdio            |
| `serve` | Start the HTTP gateway                     |
| `agent` | Run a workflow step using a built-in agent |

## Using `realm agent`

| Flag                | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| `--workflow <path>` | Path to workflow directory or `workflow.yaml` file             |
| `--provider <name>` | LLM provider: `openai` or `anthropic` (auto-detected from env) |
| `--model <name>`    | Model name override (default: `gpt-4o` / `claude-sonnet-4-5`)  |
| `--base-url <url>`  | Base URL for OpenAI-compatible endpoints                       |
| `--run-id <id>`     | Attach to an existing run                                      |
| `--params <json>`   | Initial run parameters as JSON                                 |
| `--register`        | Persist the workflow definition to `~/.realm/workflows/`       |

**DeepSeek / Qwen / other OpenAI-compatible providers:**

```bash
OPENAI_API_KEY=<your-key> realm agent \
  --workflow ./my-workflow \
  --provider openai \
  --base-url https://api.deepseek.com \
  --model deepseek-chat
```

## Custom Providers

`realm agent` supports custom LLM providers via `--provider-module`. Pass the path to an ESM
module that exports an instance of `LlmProvider` or `ToolCapableLlmProvider` as its default
export.

**Minimal example:**

```typescript
// my-ollama-provider.ts
import { LlmProvider } from '@sensigo/realm-cli/agent';

class OllamaProvider extends LlmProvider {
  async callStep(prompt: string): Promise<Record<string, unknown>> {
    // call your local Ollama endpoint here
    const response = await fetch('http://localhost:11434/api/generate', { ... });
    return await response.json() as Record<string, unknown>;
  }
}

export default new OllamaProvider();
```

```bash
realm agent --workflow ./my-workflow --provider-module ./my-ollama-provider.js
```

The module must export an **instance** (not a class) as its default export. The instance must
extend `LlmProvider` (for basic steps) or `ToolCapableLlmProvider` (for tool-enabled steps),
both exported from `@sensigo/realm-cli/agent`.

Custom provider modules are user-supplied code executed in the same process as `realm agent`.
Only use modules you trust.

`--provider-module` cannot be combined with `--provider`, `--model`, or `--base-url`.

## Programmatic extension

The `@sensigo/realm-cli` package exports its command groups for embedding in custom CLI applications. Import `workflowCommands`, `runCommands`, and `topLevelCommands` (arrays of `Command` objects from `commander`) and register them into your own CLI program.

## Full documentation

Full documentation: https://github.com/sensigo-hq/realm
