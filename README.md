# Realm

**Reliable Agent Lifecycle Management**

A workflow execution engine that makes AI agents follow instructions reliably and produces evidence of what they did.

## What This Is

Realm lets you define multi-step workflows in YAML. When an AI agent executes a workflow, the engine:

- Guides the agent step by step, telling it exactly what to do and what comes next
- Guards execution order — the agent cannot skip steps or execute out of sequence
- Captures evidence at every step — what was received, what was produced, what decisions were made
- Enforces human gates where a human must approve before execution continues

## Status

**Early development.** Monorepo scaffolding is complete. Engine implementation begins in Phase 1.

## Packages

| Package | Description |
|---------|-------------|
| `@sensigo/realm` | Core workflow execution engine |
| `@sensigo/realm-cli` | Command-line interface (`realm` binary) |
| `@sensigo/realm-mcp` | MCP server for AI agent connections |
| `@sensigo/realm-testing` | Testing utilities for Realm workflows |

## Development

**Prerequisites:** Node.js 20+, npm 10+

```bash
npm install
npm run build    # compile all packages
npm run test     # run all tests
npm run lint     # lint all packages
```

## License

MIT
