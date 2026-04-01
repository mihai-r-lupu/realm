# Realm — GitHub Repository Settings

## Repository Name

```
sensigo/realm
```

## Description (one-liner, max 350 chars)

```
Make AI agents follow instructions reliably and prove what they did. State machine engine with evidence chains, human gates, and auditable execution — via MCP or CLI.
```

Why this works: it says what the product does (make AI agents reliable), how it does it (state machine, evidence chains), and how you use it (MCP or CLI) — in one line. No buzzwords, no hype. A developer reads this and knows exactly what they're looking at.

Alternative options (pick one):

```
Engine that drives AI agents step-by-step through verified workflows. Evidence chains prove every output came from real sources. YAML-defined, MCP-connected.
```

```
Verified AI workflow execution. Define steps in YAML, connect agents via MCP, get evidence chains that prove every output. Open source.
```

## Website URL

```
https://sensigo.dev/realm
```

## Topics (max 20, ordered by discoverability)

```
ai-agents
mcp
workflow-engine
llm
ai-orchestration
evidence-chain
rag
typescript
audit-trail
human-in-the-loop
state-machine
model-context-protocol
ai-workflow
verified-execution
yaml
developer-tools
open-source
cli
observability
ai-reliability
```

Why these topics:
- `ai-agents` — the primary discovery keyword, highest traffic
- `mcp` / `model-context-protocol` — developers searching for MCP tools will find Realm
- `workflow-engine` — category match with Temporal, Airflow, Prefect
- `llm` — broad AI keyword, high traffic
- `ai-orchestration` — matches the pain point (orchestration complexity)
- `evidence-chain` — unique to Realm, establishes the term
- `rag` — every RAG developer is a potential user
- `typescript` — language filter, large audience
- `audit-trail` — enterprise discovery keyword
- `human-in-the-loop` — matches Pain Point 7
- `state-machine` — technical architecture keyword
- `ai-workflow` — broad category
- `verified-execution` — unique positioning keyword
- `yaml` — workflow definition format
- `developer-tools` — broad category
- `open-source` — signals license and community
- `cli` — developers searching for CLI tools
- `observability` — matches the observability pain point
- `ai-reliability` — the core value proposition

## Settings

### General

- **Visibility:** Public
- **Default branch:** `main`
- **Template repository:** No
- **Require contributors to sign off on web-based commits:** No (reduces friction)
- **Automatically delete head branches:** Yes (clean up after merged PRs)
- **Allow auto-merge:** Yes
- **Allow squash merging:** Yes (default merge method)
- **Allow merge commits:** Yes
- **Allow rebase merging:** No (keeps history cleaner)
- **Always suggest updating pull request branches:** Yes

### Features (enable)

- [x] Issues
- [x] Discussions (for community Q&A — cheaper than Discord to start)
- [x] Projects (for public roadmap board)
- [x] Wiki — No (docs live in the repo under /docs)
- [x] Sponsorships (GitHub Sponsors — enable once you have traction)

### Branch Protection Rules (for `main`)

- **Require pull request before merging:** Yes
  - Required approving reviews: 0 (solo developer, but the rule exists for when contributors join)
- **Require status checks to pass:** Yes
  - Required checks: `lint`, `test`, `build`
- **Require branches to be up to date before merging:** Yes
- **Require signed commits:** No (friction for contributors)
- **Require linear history:** Yes (squash merge enforces this)
- **Allow force pushes:** No
- **Allow deletions:** No

### Security

- **Dependabot alerts:** Enable
- **Dependabot security updates:** Enable
- **Secret scanning:** Enable
- **Code scanning (CodeQL):** Enable for TypeScript

## Labels

Beyond GitHub's defaults, add these custom labels:

| Label | Color | Description |
|-------|-------|-------------|
| `engine` | `#0075ca` | Core engine (runtime, state machine, evidence) |
| `cli` | `#006b75` | CLI commands and experience |
| `mcp` | `#5319e7` | MCP server and tools |
| `adapters` | `#d876e3` | Service adapters (Bubble, Salesforce, etc.) |
| `expression-lang` | `#fbca04` | Expression language evaluator |
| `yaml` | `#f9d0c4` | Workflow YAML format and loader |
| `testing` | `#0e8a16` | Testing package and fixtures |
| `docs` | `#c5def5` | Documentation |
| `good first issue` | `#7057ff` | Good for newcomers (GitHub default) |
| `help wanted` | `#008672` | Extra attention needed (GitHub default) |
| `cloud` | `#e4e669` | Cloud-only features |
| `rag` | `#1d76db` | RAG integration and auditable retrieval |
| `phase-1` | `#ededed` | Phase 1 implementation |
| `phase-2` | `#ededed` | Phase 2 implementation |
| `phase-3` | `#ededed` | Phase 3 implementation |

## Issue Templates

### Bug Report (`.github/ISSUE_TEMPLATE/bug_report.md`)

```markdown
---
name: Bug Report
about: Something isn't working as expected
title: '[Bug] '
labels: bug
---

**What happened?**
A clear description of the bug.

**What did you expect?**
What should have happened instead.

**Steps to reproduce:**
1. 
2. 
3. 

**Environment:**
- Realm version:
- Node.js version:
- OS:
- MCP client (if applicable):

**Relevant YAML / error output:**
```

### Feature Request (`.github/ISSUE_TEMPLATE/feature_request.md`)

```markdown
---
name: Feature Request
about: Suggest an improvement or new capability
title: '[Feature] '
labels: enhancement
---

**What problem does this solve?**
Describe the use case or pain point.

**What does the solution look like?**
How should it work from the developer's perspective?

**Alternatives considered:**
Other approaches you've thought about.
```

## README Structure

The README is the most important file. It determines whether a developer installs the package or moves on. Structure:

```
# Realm

One-line description.

## What it does (3 sentences max)

## Quick Start (under 2 minutes to first result)

  npm install
  realm init
  realm run
  → see evidence chain output

## Why (the problem it solves — 1 paragraph)

## How it works (diagram or 5-line explanation)

## Features (bullet list, 8-10 items, no fluff)

## Documentation links

## Contributing

## License
```

Rules for the README:
- No badges wall at the top (adds clutter before the developer sees what it does)
- First code block within the first screen (developer sees how to use it immediately)
- No "Table of Contents" (too formal for a dev tool README)
- Demo GIF or screenshot above the fold if possible (week 13, record a terminal session of an agent driving a workflow)
- Links to docs, not inline documentation (keep the README short)

## LICENSE

```
Apache-2.0
```

Why Apache-2.0: permissive like MIT but includes a patent grant. Standard for developer infrastructure (Kubernetes, Temporal, TensorFlow all use Apache-2.0). Enterprise-friendly. Doesn't scare away corporate contributors.

## .gitignore

```
node_modules/
dist/
.turbo/
*.tsbuildinfo
.env
.env.local
runs/
.realm/
coverage/
*.log
.DS_Store
```

## Funding (`.github/FUNDING.yml`)

```yaml
github: sensigo
custom: ["https://sensigo.dev/realm/sponsor"]
```

Enable when the project has traction. Not at launch — it looks presumptuous on an empty repo.

## Social Preview Image

Create a simple, clean 1280x640 image:
- Dark background
- "Realm" in large white text
- Tagline: "Verified AI Workflow Execution"
- Sensigo logo small in corner
- No gradients, no illustrations, no complexity

This appears when someone shares the repo link on Twitter, Slack, or Discord.
