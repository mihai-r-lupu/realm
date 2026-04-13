---
name: realm-content-pipeline
description: "Enrich an article through Realm's evidence-tracked content pipeline.
  Triggers on: 'enrich this article with Realm', 'summarise and tag this article with Realm',
  'run the content pipeline with Realm', or any request to summarise and tag content through Realm.
  Entry point: start_run on workflow_id 'content-pipeline' with params.path pointing
  to the article text file."
---

Use this workflow when the user asks to enrich, summarise, or tag an article through Realm.
Pass the article file path as `params.path` to `start_run` — Realm reads the file automatically.
Follow the Realm protocol in `realm.instructions.md` from there.
