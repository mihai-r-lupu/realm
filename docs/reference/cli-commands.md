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

Validates a workflow YAML without registering it. Reports schema errors, duplicate state names,
unreachable states, and invalid transition targets.

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

### `realm workflow run <path>`

Runs a workflow interactively in development mode. For each agent step, prompts for JSON output.
For human gates, prompts for approval. Use this to exercise the full state machine without an
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
description: "Complete happy-path run"
params: {}
steps:
  gather_input:
    output:
      summary: "the collected information"
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

Output per run: `run-id  workflow-id vN  state  timestamp  N step(s)`

State colors: green = completed, red = failed/abandoned, cyan = gate_waiting, yellow = in-progress.

---

### `realm run inspect <run-id>`

Prints the full run record: state, workflow, creation and update timestamps, and the complete
evidence chain. Color-coded terminal output.

```bash
realm run inspect abc123
```

Each evidence entry shows: step name, agent profile (if set), status, duration, hash, input
summary, output summary, and diagnostics (token estimate and precondition trace).

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
