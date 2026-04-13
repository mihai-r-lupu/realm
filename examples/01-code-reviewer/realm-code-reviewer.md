---
name: realm-code-reviewer
description: >-
  Run a structured code review through Realm's evidence-tracked workflow.
  Triggers on: 'review this diff with Realm', 'run a structured code review with Realm',
  'code review with Realm', or any request to review a diff or code change through Realm.
  Entry point: start_run on workflow_id 'code-reviewer' with params.path pointing
  to the diff file.
---

Use this workflow when the user asks to review a diff or code change through Realm.
Pass the diff file path as `params.path` to `start_run` — Realm reads the file
automatically via the filesystem adapter.
Follow the Realm protocol in `realm.instructions.md` from there.
