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

Prints the full run record and evidence chain for a workflow run. This is the primary
debugging tool — use it whenever a run fails, gets stuck, or produces unexpected output.

```bash
realm run inspect abc12345-0000-0000-0000-000000000000
```

#### Output format

```
Run: abc12345-0000-0000-0000-000000000000
Workflow: incident-response v3
State: completed  ✓

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

**State colors:** green = completed, red = failed or abandoned, yellow = in-progress or
gate_waiting, cyan = gate_waiting.

**Output truncation:** Input and Output fields are truncated at 120 characters. A `…` suffix
indicates truncation — use `realm run replay` to re-evaluate with modified values.

#### Field reference

| Field | What it tells you |
|---|---|
| **State** | Current state name. Terminal runs show `✓` (completed) or no suffix (failed/abandoned). |
| **Evidence (N steps)** | Number of distinct steps that produced evidence. Steps with multiple attempts are counted once. |
| **Step number** | Execution order, 1-based. |
| **Step name** | The `id` of the step in your workflow YAML. |
| **`[profile: ...]`** | Which agent profile handled this step. Present on agent steps only; absent on auto steps and human gates. |
| **Status** | `success` (green), `error` (red), or other engine-assigned state (yellow). |
| **Duration** | Wall-clock time the step took to complete. High values on agent steps are normal. |
| **`hash: XXXXXXXX`** | First 8 characters of the SHA-256 chain hash. The hash covers all evidence up to and including this step — it changes if any prior step's output changes. Use it to detect replay divergence. |
| **Input** | What the step received. For the first step: the run params. For subsequent steps: the output of the prior step (or merged outputs if `input_map` is configured). |
| **Output** | What the step produced. For agent steps: the JSON the AI returned. For auto steps: the handler return value. For adapter steps: the raw adapter response injected by the engine. |
| **Diagnostics: `~N tokens`** | Estimated token count of the context window passed to the agent for this step. Useful for spotting steps that approach model context limits. |
| **Diagnostics: preconditions** | Each precondition expression, whether it passed (`→ true`) or failed (`→ false`), and the resolved value in parentheses. If a step ran unexpectedly or was blocked, this is where you look. |

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
