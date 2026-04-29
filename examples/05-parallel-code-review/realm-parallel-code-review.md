---
name: realm-parallel-code-review
description: >-
  Run a parallel security and performance code review through Realm.
  Triggers on: 'review this diff with Realm', 'run a parallel code review with Realm',
  'security and performance review with Realm', or any request to review a diff through Realm.
  Entry point: start_run on workflow_id 'parallel-code-review' with params.path pointing
  to the diff file.
---

Use this workflow when the user asks to review a code diff through Realm.
Pass the diff file path as `params.path` to `start_run` — Realm reads the file automatically.
After `read_diff` completes, the response contains two items in `next_actions`: one for
`review_security` and one for `review_performance`. Execute both before waiting for the
synthesis step.
Follow the Realm protocol in `realm.instructions.md` from there.
