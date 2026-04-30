---
name: realm-ticket-router
description: >-
  Route a support ticket through Realm's when-condition workflow.
  Triggers on: 'route this ticket with Realm', 'triage this support ticket with Realm',
  'run ticket routing with Realm', or any request to route or triage a ticket through Realm.
  Entry point: start_run on workflow_id 'ticket-router' with params.path pointing
  to the support ticket text file.
---

Use this workflow when the user asks to route or triage a support ticket through Realm.
Pass the ticket file path as `params.path` to `start_run` — Realm reads the file
automatically via the filesystem adapter. Exactly one of five category handlers will
execute; the other four appear in skipped_steps.
Follow the Realm protocol in `realm.instructions.md` from there.
