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

## Custom Providers (0.2.0)

`realm agent` currently supports `openai` and `anthropic` as built-in providers.
OpenAI-compatible endpoints (DeepSeek, Qwen, Groq, Together, local vLLM) are supported
today via `--base-url`.

Support for fully custom providers via `--provider-module <path>` is planned for 0.2.0.
This will allow passing a module that exports a default `LlmProvider` or
`ToolCapableLlmProvider` implementation (both exported from `@sensigo/realm-cli/agent`).
The interfaces are stable as of 0.1.0.

Custom provider modules are user-supplied code executed in the same process as `realm agent`.
Only use modules you trust.

## Programmatic extension

The `@sensigo/realm-cli` package exports its command groups for embedding in custom CLI applications. Import `workflowCommands`, `runCommands`, and `topLevelCommands` (arrays of `Command` objects from `commander`) and register them into your own CLI program.

## Full documentation

Full documentation: https://github.com/sensigo-hq/realm
