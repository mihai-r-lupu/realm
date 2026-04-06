# Example 3 — Document Intake with Conditional Branching

## What this shows

A five-step document intake workflow demonstrating both conditional branching mechanisms:

- **`on_error` transition**: if the `validate_fields` auto step throws a `WorkflowError`,  
  the run branches to `extract_fields` (state → `revision_requested`) instead of failing.
- **Gate-response transition**: if a human reviewer rejects the extracted fields  
  at `confirm_submission`, the run branches back to `extract_fields` (state → `revision_requested`).

In both cases the run stays alive — no terminal failure. The `extract_fields` agent  
step's `allowed_from_states` includes both `document_ready` (first pass) and  
`revision_requested` (any re-run), and its `input_schema` includes an optional  
`revision_notes` field so the agent can explain what it corrected.

## Steps and branching paths

```
read_document      (auto — filesystem adapter, reads the source document)
       │ → document_ready
extract_fields     (agent — extracts title, author, date, summary)
       │ → fields_extracted
validate_fields    (auto — handler validates field quality)
       │ → validated        (happy path)
       └─ on_error ──────────────────────────────────────────────────────┐
confirm_submission (auto — human gate: approve / reject)                 │
       │ → submitted        (approve)                                    │
       └─ on_reject ─────────────────────────────────────────────────────┤
submit_record      (auto — records the approved intake)                  │
       │ → completed                                                     │
                                                                         │
       ┌─────────────────── revision_requested ◄────────────────────────┘
extract_fields     (agent — re-runs with revision_notes)
```

## Install

```bash
npm install  # from repo root — installs all workspace packages
```

## Build

```bash
cd examples/document-intake
npm run build
```

## Run with an AI agent (VS Code / MCP)

**Step 1** — Build (see above).

**Step 2** — VS Code picks up `.vscode/mcp.json` automatically. The  
`realm-document-intake` MCP server starts on first use.

**Step 3** — In Copilot chat, ask:
> "Run the document intake workflow on this file: /path/to/document.txt"

The agent will:
1. Start the run — `read_document` and any auto steps execute immediately.
2. Receive a `next_action.prompt` asking it to extract fields.
3. Submit extracted fields via `execute_step`.
4. If validation fails, receive `next_action` pointing back at `extract_fields`  
   with a warning explaining what was wrong.
5. Submit corrected fields.
6. Receive a human gate for `confirm_submission` — present the fields to the user  
   and collect `approve` / `reject`.
7. On approval, `submit_record` runs and the intake completes.

## Configuration reference

`params_schema` requires:

| Field | Type   | Description                                 |
|-------|--------|---------------------------------------------|
| path  | string | Absolute path to the intake document file.  |

## Run tests

```bash
# from repo root:
npm test
```
