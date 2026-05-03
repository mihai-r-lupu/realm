# @sensigo/realm-cli

`@sensigo/realm-cli` — the Realm command-line interface. Manages workflow registration, triggers runs, and inspects run history.

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

## Programmatic extension

The `@sensigo/realm-cli` package exports its command groups for embedding in custom CLI applications. Import `workflowCommands`, `runCommands`, and `topLevelCommands` (arrays of `Command` objects from `commander`) and register them into your own CLI program.

## Full documentation

Full documentation: https://github.com/mihai-r-lupu/realm
