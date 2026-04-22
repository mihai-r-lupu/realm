# CLI Reference

All `@sensigo/realm-cli` commands. Run `realm <group> <command> --help` for full option details.

---

## Workflow commands

Operations on workflow definitions and YAML files.

---

### `realm workflow init <name>`

Scaffolds a new workflow project directory.

```bash
realm workflow init my-workflow
```

Creates `my-workflow/` containing `workflow.yaml`, `schema.json`, `.env.example`, and `README.md`.

---

### `realm workflow validate <path>`

Validates a workflow YAML without registering it. Reports schema errors, duplicate step IDs,
and invalid `depends_on` references.

```bash
realm workflow validate ./my-workflow
```

---

### `realm workflow register <path>`

Registers a workflow in the local store (`~/.realm/workflows/`). Increments the version number
on each call. Fails immediately if any agent profile declared in the workflow is not found in
`profiles_dir`.

```bash
realm workflow register ./my-workflow
```

---

### `realm workflow watch <path>`

Watches a workflow YAML file and re-registers it into the local store on every change.
Performs an initial registration immediately on startup, then re-registers whenever the
file is modified — no manual `realm workflow register` required during active development.

```bash
realm workflow watch ./my-workflow
realm workflow watch ./my-workflow/workflow.yaml   # or point directly at the file
```

Press `Ctrl+C` to stop watching.

Errors from an invalid YAML edit are logged (with a timestamp) to stderr but do not crash
the watcher — fix the file and save again to recover.

**Development inner loop:**

1. Start `realm workflow watch ./my-workflow` in one terminal.
2. Edit `workflow.yaml` freely — every save auto-registers.
3. Run `realm workflow run ./my-workflow` or start your MCP session in another terminal.

---

### `realm workflow run <path>`

Runs a workflow interactively in development mode. For each agent step, prompts for JSON output.
For human gates, prompts for approval. Use this to exercise the full workflow without an
AI agent.

```bash
realm workflow run ./my-workflow
realm workflow run ./my-workflow --params '{"company_name":"Acme"}'
```

---

### `realm workflow test <path>`

Runs fixture-based tests against a workflow. Loads fixtures from the specified directory,
executes each scenario with mocked services and pre-built agent responses, and checks expected
final states and step outputs.

```bash
realm workflow test ./my-workflow --fixtures ./my-workflow/fixtures/
```

Fixture format (`fixtures/happy-path.yaml`):

```yaml
workflow: my-workflow
description: 'Complete happy-path run'
params: {}
steps:
  gather_input:
    output:
      summary: 'the collected information'
expected_final_state: completed
```

---

## Run commands

Operations on workflow run instances stored in `~/.realm/runs/`.

---

### `realm run list`

Lists all runs, sorted by most recent first.

```bash
realm run list
realm run list --workflow <workflow-id>   # filter by workflow
```

Output per run: `run-id  workflow-id vN  run_phase  timestamp  N step(s)`

`N step(s)` is the count of distinct steps that produced evidence (retried steps count once;
gate responses are excluded). This is the same count shown in
`realm run inspect` under `Evidence (N steps):`.

State colors: green = completed, red = failed/abandoned, cyan = gate_waiting, yellow = in-progress.

---

### `realm run inspect <run-id>`

Prints the full run record and evidence chain for a workflow run. This is the primary
debugging tool — use it whenever a run fails, gets stuck, or produces unexpected output.

```bash
realm run inspect abc12345-0000-0000-0000-000000000000
```

#### Output format

```
Run: abc12345-0000-0000-0000-000000000000
Workflow: incident-response v3
Phase: completed  ✓

Created: 2026-01-15T10:30:00.000Z
Updated: 2026-01-15T10:30:42.000Z

Evidence (3 steps):

  1. read_alert                success    12ms   hash: f3a9b2c1
     Input:  {"path":"/tmp/alert.md"}
     Output: {"content":"## SEV-2 Alert\nDisk usage on prod-db-1 at 94%","line_count":14}
     Diagnostics: ~200 tokens | no preconditions

  2. analyze_cause             [profile: senior-sre] success   8432ms   hash: 2d7e4f81
     Input:  {"content":"## SEV-2 Alert\nDisk usage on prod-db-1 at 94%"}
     Output: {"root_cause":"log_rotation_disabled","severity":"sev2","affected_system":"prod-db-1"}
     Diagnostics: ~1840 tokens | preconditions: analyze_cause.result.content != "" → true ("")

  3. draft_response            [profile: senior-sre] success   5211ms   hash: 9c3b1a0f
     Input:  {"root_cause":"log_rotation_disabled","severity":"sev2","affected_system":"prod-db-1"}
     Output: {"message":"SEV-2 on prod-db-1: log rotation was disabled causing disk accumulation…"}
     Diagnostics: ~2100 tokens | preconditions: draft_response.result.root_cause != "" → true (log_rot…)
```

**State colors:** green = completed, red = failed or abandoned, yellow = anything else (including gate_waiting and in-progress).

**Output truncation:** Input and Output fields are truncated at 120 characters. A `…` suffix
indicates truncation — use `realm run replay` to re-evaluate with modified values.

**Human gate steps:** A gate step appears in the evidence chain as a single entry — the same
step ID covers both the gate opening (when the engine paused for human input) and the gate
response (when a choice was submitted via `realm run respond`). The step count does not
increase when a gate is responded to.

#### Field reference

| Field                          | What it tells you                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase**                      | Current run phase (`run_phase`). Terminal runs show `✓` (completed) or no suffix (failed/abandoned).                                                                                          |
| **Evidence (N steps)**         | Number of distinct steps that produced evidence. Steps with multiple attempts are counted once. Human gate steps are counted once regardless of whether the gate has been responded to.       |
| **Step number**                | Execution order, 1-based.                                                                                                                                                                     |
| **Step name**                  | The `id` of the step in your workflow YAML.                                                                                                                                                   |
| **`[profile: ...]`**           | Which agent profile handled this step. Present on agent steps only; absent on auto steps and human gates.                                                                                     |
| **Status**                     | `success` (green), `error` (red), or other engine-assigned state (yellow).                                                                                                                    |
| **Duration**                   | Wall-clock time the step took to complete. High values on agent steps are normal.                                                                                                             |
| **`hash: XXXXXXXX`**           | First 8 characters of the SHA-256 chain hash. The hash covers all evidence up to and including this step — it changes if any prior step's output changes. Use it to detect replay divergence. |
| **Input**                      | What the step received. For the first step: the run params. For subsequent steps: the output of the prior step (or merged outputs if `input_map` is configured).                              |
| **Output**                     | What the step produced. For agent steps: the JSON the AI returned. For auto steps: the handler return value. For adapter steps: the raw adapter response injected by the engine.              |
| **Diagnostics: `~N tokens`**   | Estimated token count of the context window passed to the agent for this step. Useful for spotting steps that approach model context limits.                                                  |
| **Diagnostics: preconditions** | Each precondition expression, whether it passed (`→ true`) or failed (`→ false`), and the resolved value in parentheses. If a step ran unexpectedly or was blocked, this is where you look.   |

#### What to look for

**Run failed — step shows `error`:**
Read the failed step's `Output` field. For handler steps, the error message is in the output.
For agent steps, the output may be missing required fields — compare its shape against the
`input_schema` of the step that consumes it in your workflow YAML.

**Run stuck at a gate (`gate_waiting` state):**
The state line will show `gate_waiting` in yellow. Look at the last entry in the evidence
chain — it will be the step that produced the gate. Submit the gate response with
`realm run respond <run-id>`.

**Precondition blocked a step unexpectedly:**
Find the step that was supposed to run and look at its `precondition_trace`. Each expression
shows the actual resolved value in parentheses. The value will tell you whether the prior step
produced the right field name, type, or content. Cross-reference with the prior step's
`Output` field to see what was actually returned.

**Agent returned wrong output shape:**
Find the agent step in the evidence chain and read its `Output`. Compare the field names and
types against the `input_schema` of the next step in your YAML. The mismatch will be visible
— missing keys, wrong types, or extra nesting are common causes of precondition failures.

---

### `realm run resume <run-id>`

Resets a failed or abandoned run to a state where a specific step can re-execute.

```bash
realm run resume abc123 --from <step-name>
```

---

### `realm run respond <run-id>`

Submits a human gate response interactively. Prompts for the gate choice.

```bash
realm run respond abc123
```

---

### `realm run replay <run-id>`

Re-evaluates workflow preconditions with modified step outputs. Shows what would change without
executing anything. Useful for tuning extraction schemas and precondition expressions.

```bash
realm run replay abc123
realm run replay abc123 --with "step_id.field=value"
```

**`--with` syntax:** `step_id.field_path=literal_value` where `step_id` is the step name,
`field_path` is a dot-separated path into the step's output, and `literal_value` is one of:

- `true` or `false` — boolean
- A number (e.g. `0.85`, `3`) — numeric
- A quoted string (e.g. `"high"`) — string
- An unquoted string (any other value) — treated as a string

Multiple `--with` flags may be specified. Each override applies to the in-memory replay
evidence only — no run record is modified.

---

### `realm run diff <run-a> <run-b>`

Compares the evidence chains of two runs side by side. Shows which steps produced different
results and which fields changed.

```bash
realm run diff abc123 def456
```

---

### `realm run cleanup`

Marks idle non-terminal runs as abandoned.

```bash
realm run cleanup --older-than 30d   # abandon runs idle for 30+ days
realm run cleanup --dry-run          # preview without making changes
```

`--older-than` accepts: `Nd` (days), `Nh` (hours), `Nm` (minutes). Example: `7d`, `6h`, `30m`.

---

## MCP server commands

---

### `realm mcp`

Starts the Realm MCP server over stdio. All workflows registered via `realm workflow register`
are immediately available. Use this command in AI client configs (Claude Desktop, Cursor, VS Code
MCP) that can spawn a local subprocess.

```bash
realm mcp
```

**Claude Desktop — `claude_desktop_config.json`:**

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": ["mcp"]
    }
  }
}
```

**Cursor — `~/.cursor/mcp.json`:**

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": ["mcp"]
    }
  }
}
```

**VS Code — `.vscode/mcp.json`:**

```json
{
  "servers": {
    "realm": {
      "type": "stdio",
      "command": "realm",
      "args": ["mcp"]
    }
  }
}
```

---

### `realm serve`

Starts the Realm MCP server over HTTP with Bearer token authentication. Designed for hosted
agent platforms (OpenClaw, Claude.ai, LangChain cloud, custom backends) that cannot spawn a
local subprocess via stdio.

```bash
REALM_SERVE_TOKEN=<secret> realm serve
REALM_SERVE_TOKEN=<secret> realm serve --port 8080 --host 0.0.0.0
realm serve --dev   # disable auth for local development only
```

| Option             | Default     | Description                                                        |
| ------------------ | ----------- | ------------------------------------------------------------------ |
| `--port <number>`  | `3001`      | Port to listen on                                                  |
| `--host <address>` | `127.0.0.1` | Bind address                                                       |
| `--dev`            | off         | Disable auth (local development only — do not expose to a network) |

**Environment variables:**

| Variable            | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `REALM_SERVE_TOKEN` | Bearer token clients must send in the `Authorization: Bearer <token>` header |
| `REALM_DEV`         | Set to `1` to disable auth — equivalent to the `--dev` flag                  |

The server refuses to start if neither `REALM_SERVE_TOKEN` nor `--dev` / `REALM_DEV=1` is set.

**Connecting from an HTTP MCP client (e.g. n8n, VS Code remote):**

```json
{
  "servers": {
    "realm": {
      "type": "http",
      "url": "http://127.0.0.1:3001",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

---

## Cloud Sync Commands

The following commands require Realm Cloud credentials. Run `realm login` to authenticate first.

---

### `realm login`

Authenticates with Realm Cloud by opening the browser to the OAuth flow. Credentials are stored
locally and used by all subsequent cloud commands.

```bash
realm login
realm login --url https://your-realm-instance.example.com
```

| Option        | Default                    | Description           |
| ------------- | -------------------------- | --------------------- |
| `--url <url>` | `https://app.realm.dev`    | Cloud base URL        |

---

### `realm logout`

Removes stored Realm Cloud credentials from the local machine.

```bash
realm logout
```

---

### `realm deploy <path>`

Deploys a single local workflow to Realm Cloud. The workflow is loaded from the given path
and registered in the cloud store.

```bash
realm deploy ./my-workflow
realm deploy ./my-workflow/workflow.yaml
```

---

### `realm migrate`

Migrates all local workflows and runs to Realm Cloud in a single operation. Useful for
bootstrapping a new cloud environment from an existing local store.

```bash
realm migrate
```

---

### `realm push [path]`

Pushes one or all local workflows to Realm Cloud.

- Without `--all`, `<path>` must point to a workflow directory or YAML file.
- Diverged workflows (present in both stores with different content) are blocked unless
  `--strategy keep-local` is set.

```bash
realm push ./my-workflow            # push a single workflow by path
realm push --all                    # push all local workflows
realm push --all --strategy keep-local   # overwrite cloud with local on divergence
```

| Option                   | Default    | Description                                                   |
| ------------------------ | ---------- | ------------------------------------------------------------- |
| `--all`                  | off        | Push all locally registered workflows                         |
| `--strategy <strategy>`  | `manual`   | Conflict resolution: `manual`, `keep-local`, `keep-cloud`     |

Exit code 1 if any workflow is blocked or fails.

---

### `realm pull [id]`

Pulls one or all cloud workflows to the local store.

- Without `--all`, `<id>` must be a workflow ID that exists in the cloud store.
- Diverged workflows are blocked unless `--strategy keep-cloud` is set.

```bash
realm pull my-workflow-id                    # pull a single workflow by ID
realm pull --all                             # pull all cloud workflows
realm pull --all --strategy keep-cloud       # overwrite local with cloud on divergence
```

| Option                   | Default    | Description                                                   |
| ------------------------ | ---------- | ------------------------------------------------------------- |
| `--all`                  | off        | Pull all cloud workflows                                      |
| `--strategy <strategy>`  | `manual`   | Conflict resolution: `manual`, `keep-local`, `keep-cloud`     |

Exit code 1 if any workflow is blocked or fails.

---

### `realm sync`

Computes and optionally applies a two-way sync plan between the local store and Realm Cloud.
By default this is a **dry-run** — it prints the plan without making any changes.

Workflows are classified into four buckets:

| Classification | Meaning                                              |
| -------------- | ---------------------------------------------------- |
| `only_local`   | Exists locally, not in cloud → planned action: push  |
| `only_cloud`   | Exists in cloud, not locally → planned action: pull  |
| `identical`    | Both stores have the same definition → skip          |
| `diverged`     | Both stores have the workflow but they differ → blocked unless `--strategy` resolves it |

```bash
realm sync                                      # dry-run: show plan
realm sync --apply                              # execute the plan
realm sync --apply --strategy keep-local        # apply, overwriting cloud on divergence
realm sync --json                               # output plan as JSON (dry-run)
realm sync --apply --json                       # output plan + result as JSON
```

| Option                   | Default    | Description                                                            |
| ------------------------ | ---------- | ---------------------------------------------------------------------- |
| `--apply`                | off        | Execute the sync plan (mutations enabled)                              |
| `--strategy <strategy>`  | `manual`   | Conflict resolution for diverged workflows: `manual`, `keep-local`, `keep-cloud` |
| `--json`                 | off        | Output plan (and result if `--apply`) as JSON for machine consumption  |

Exit code 1 if any workflow is blocked or has errors.
