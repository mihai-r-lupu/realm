# Example 4 — Persistent State: Fail at Step 3, Resume from Step 3

This is a four-step content enrichment pipeline that demonstrates what happens when
`tag_content` receives a provider timeout. `fetch_content` and `summarise` are already
`completed` before the failure occurs — `realm run resume` continues from step 3 without
re-running anything. No tokens are re-spent on steps that already produced validated outputs,
and no side effects are re-fired.

## Pain points addressed

- **State management / no checkpoint resume (#4)** — `realm run resume <run-id> --from
  tag_content` continues from step 3; `fetch_content` and `summarise` are not re-run. Their
  validated outputs are already in the evidence chain.
- **LLM provider reliability / timeouts (#10)** — a timeout at `tag_content` pauses the run
  in the step's pending state; the run is not lost. The evidence chain preserves everything
  completed so far.
- **Verification gap (#8)** — the resumed `tag_content` validates its output the same way as
  the first attempt. Schema enforcement applies on retry — the tagger cannot submit a
  malformed tags list on resumption any more than it could on the first attempt.

## The before / after

**Before (a plain Python pipeline — restarts from step 1 on any failure):**

```python
def enrich_article(path: str) -> dict:
    content = read_file(path)               # step 1
    summary = llm.summarise(content)        # step 2 — already succeeded
    tags = llm.tag(summary)                 # step 3 — times out
    record(summary, tags)                   # step 4 — never reached
    return {"summary": summary, "tags": tags}

# On timeout:
enrich_article(path)  # retries from step 1 — re-reads, re-summarises, re-tags
                      # tokens re-spent on steps 1 and 2
                      # no record of which attempt succeeded
                      # side effects on record() could fire twice
```

Everything restarts from the top. Tokens are re-spent on steps that already succeeded.
There is no record of which attempt actually produced the accepted output.

**After (Realm — resume from where it stopped):**

```bash
realm run resume <run-id> --from tag_content
```

`fetch_content` and `summarise` are already `completed`. The run resumes at `tag_content`
with the same schema-validated `summarise` outputs as inputs — no re-runs, no double spend.

## Steps

```
fetch_content  (auto — filesystem adapter, loads the article text)
     │ → content_fetched
summarise      (agent — produces: title, summary, word_count)
     │ → summarised    ← schema enforced before tag_content starts
tag_content    (agent — reads context.resources.summarise; produces: tags[])
     │ → tagged        ← the step a provider timeout targets
record_result  (auto — records title, summary, tags in the evidence chain)
     │ → completed
```

`summarise` and `tag_content` each have their own `input_schema`. Each must pass before the
run advances. The run stays in its current state on rejection — the agent receives
`agent_action: provide_input` with the validation error and resubmits. Nothing downstream
runs on bad data.

## Install and run

```bash
# Register the workflow (once, from the repo root):
realm workflow register examples/04-content-pipeline/workflow.yaml

# Start the MCP server:
realm mcp
```

With VS Code: open the workspace — `realm mcp` starts automatically via `.vscode/mcp.json`.

Then ask your agent:

> "Enrich this article with Realm: /path/to/article.txt"

The agent will:

1. Start the run — `fetch_content` executes automatically via the filesystem adapter.
2. Receive a `next_action.prompt` asking it to summarise the article. It submits `title`,
   `summary`, and `word_count`. If any field fails schema validation, it receives
   `provide_input` and must correct and resubmit. The state stays at `content_fetched` until
   the schema passes.
3. Receive a second `next_action.prompt` asking it to generate tags. The prompt already
   contains the verified title and summary from step 2. It submits `tags`. Same schema
   enforcement applies — each tag is checked for length, lowercase, and no spaces.
4. Once the tags schema passes, `record_result` runs and the workflow completes.

**When `tag_content` fails with a provider timeout:**

```bash
realm run list          # find the run-id — state will be 'summarised'
realm run resume <run-id> --from tag_content
```

Then start a new MCP session and ask the agent to continue. The run resumes at `tag_content`
with the same validated inputs. Steps 1 and 2 are not re-run.

## Inspect the evidence chain

After the run completes, check what each step received and produced:

```bash
realm run inspect <run-id>
```

The evidence chain shows four entries in order: `fetch_content`, `summarise`, `tag_content`,
`record_result`. In the resume-after-timeout scenario, `tag_content` appears twice — once
for the failed attempt (with the provider timeout error) and once for the successful retry.
You can see the timestamp of the failed attempt and the successful retry side by side. Steps
1 and 2 appear only once each — they were not re-run.

## Test headlessly

```bash
# From the repo root:
realm workflow test examples/04-content-pipeline/workflow.yaml \
  -f examples/04-content-pipeline/fixtures/
```

Two fixtures are included:

- `happy-path.yaml` — all steps succeed, no retry; final state: `completed`
- `resume-after-timeout.yaml` — `tag_content` fails once with a provider timeout, succeeds
  on retry; the evidence chain shows all four steps as `success`

## Configuration reference

`params_schema` requires:

| Field | Type   | Description                            |
| ----- | ------ | -------------------------------------- |
| path  | string | Absolute path to the article text file |

## What to look at next

- [Example 3 — Incident Response](../03-incident-response/) — the preceding example in the
  ladder; demonstrates human gates and structured approval before a message is sent
- [YAML Schema Reference](../../docs/reference/yaml-schema.md) — all step fields, execution
  modes, service adapters, and input_schema configuration
