---
name: realm-incident-response
description: "Triage an incident alert through Realm's evidence-tracked workflow.
  Triggers on: 'triage this alert with Realm', 'triage this incident with Realm',
  'analyze this alert with Realm', or any request to run incident triage through Realm.
  Entry point: start_run on workflow_id 'incident-response' with params.path pointing
  to the alert JSON file."
---

Use this workflow when the user asks to triage or analyze an alert or incident through Realm.
Pass the alert file path as `params.path` to `start_run` — Realm reads the file automatically.
Follow the Realm protocol in `realm.instructions.md` from there.
