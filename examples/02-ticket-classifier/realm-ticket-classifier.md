---
name: realm-ticket-classifier
description: >-
  Classify a support ticket through Realm's evidence-tracked workflow.
  Triggers on: 'classify this ticket with Realm', 'triage this support ticket with Realm',
  'run ticket classification with Realm', or any request to classify a ticket through Realm.
  Entry point: start_run on workflow_id 'ticket-classifier' with params.path pointing
  to the support ticket text file.
---

Use this workflow when the user asks to classify or triage a support ticket through Realm.
Pass the ticket file path as `params.path` to `start_run` — Realm reads the file
automatically via the filesystem adapter.
Follow the Realm protocol in `realm.instructions.md` from there.
