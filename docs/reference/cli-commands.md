# CLI Reference

All `@sensigo/realm-cli` commands. Run `realm <command> --help` for full option details.

---

## `realm init <name>`

Scaffolds a new workflow project directory.

```bash
realm init my-workflow
```

Creates `my-workflow/` containing `workflow.yaml`, `schema.json`, `.env.example`, and `README.md`.

---

## `realm validate <path>`

Validates a workflow YAML without registering it. Reports schema errors, duplicate state names, unreachable states, and invalid transition targets.

```bash
realm validate ./my-workflow
```

---

## `realm register <path>`

Registers a workflow in the local store (`~/.realm/`). Increments the version number on each call. Fails immediately if any agent profile declared in the workflow is not found in `profiles_dir`.

```bash
realm register ./my-workflow
```

---

## `realm run <path>`

Runs a workflow interactively in development mode. For each agent step, prompts for JSON output. For human gates, prompts for approval. Use this to exercise the full state machine without an AI agent.

```bash
realm run ./my-workflow
realm run ./my-workflow --params '{"company_name":"Acme"}'
```

---

## `realm resume <run-id>`

Resumes a paused or failed run.

```bash
realm resume abc123
```

---

## `realm respond <run-id>`

Submits a human gate response interactively. Prompts for the gate choice.

```bash
realm respond abc123
```

---

## `realm inspect <run-id>`

Prints the full run record: state, step history, evidence chain, timing, and errors. Color-coded terminal output.

```bash
realm inspect abc123
```

---

## `realm replay <run-id>`

Re-evaluates stored evidence with modified parameters. Shows what would change without executing anything. Useful for tuning extraction schemas.

```bash
realm replay abc123
realm replay abc123 --with "extract_fields.result.confidence=high"
```

---

## `realm diff <run-a> <run-b>`

Compares the evidence chains of two runs side by side. Shows which fields changed, which steps produced different results.

```bash
realm diff abc123 def456
```

---

## `realm cleanup`

Marks idle non-terminal runs as abandoned.

```bash
realm cleanup --older-than 30d   # abandon runs idle for 30+ days
realm cleanup --dry-run          # preview without making changes
```

---

## `realm test <path>`

Runs fixture-based tests against a workflow. Loads fixtures from the specified directory, executes each scenario with mocked services and pre-built agent responses, and checks expected final states and step outputs.

```bash
realm test ./my-workflow --fixtures ./my-workflow/fixtures/
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
