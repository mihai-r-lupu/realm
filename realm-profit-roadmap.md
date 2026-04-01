# Realm — Profit-Maximizing Roadmap

## Based on: Market research into AI developer pain points (April 2026)

---

## The Market Reality

### What developers are struggling with (sourced from research)

A study of 3,191 Stack Overflow posts (2021-2025) on building AI agents identified seven major pain areas. The 2025 Stack Overflow Developer Survey (49,000+ respondents) confirms the trust crisis. Multiple industry reports from Gartner, McKinsey, Forrester, IBM, and MIT Sloan reinforce the same themes.

**Pain Point 1: "Almost right but not quite" (45% of developers' top frustration)**

The #1 frustration cited by developers in the 2025 Stack Overflow survey is AI output that's "almost right, but not quite." 66% of developers say they spend more time fixing "almost-right" AI-generated output than they save. Trust in AI accuracy has dropped from 40% to 29% year-over-year. Only 3% of developers "highly trust" AI output.

**What this means for Realm:** The evidence chain and hash verification directly solve this. When the AI extracts a value, Realm proves it came from the source document with a verbatim quote. "Almost right" becomes "verifiably right or explicitly rejected." This is Realm's core differentiator.

**Pain Point 2: Orchestration complexity (13% of Stack Overflow agent questions)**

AI agents aren't linear scripts — they're dynamic graphs with parallel tool calls and multi-agent interactions. Developers struggle with configuring when and how agents invoke tools, sequencing parallel use to avoid conflicts, and managing state across multi-step workflows. Tool-Use Coordination Policies is the #1 operational challenge at 23% of questions.

**What this means for Realm:** The state machine, auto-execution mode, and structured next_action eliminate orchestration complexity. The developer defines steps in YAML, the engine handles sequencing, state transitions, and tool coordination. The agent follows instructions instead of figuring out what to do.

**Pain Point 3: The demo-to-production gap (80% of AI projects fail to reach production)**

A RAND Corporation study found over 80% of AI projects fail to reach production — double the rate of typical IT projects. Andrej Karpathy noted that creating impressive demos is easy but the leap to production is significant. MIT Sloan research found that 80% of the work in production AI is "unglamorous" — data engineering, governance, workflow integration, not model fine-tuning.

**What this means for Realm:** Realm is the production layer. The demo is the AI extracting fields from a document. The production version needs: retries on service failures, human gates for critical decisions, audit trails for compliance, structured error handling, versioned workflow definitions, and evidence chains. Realm provides all of this out of the box.

**Pain Point 4: Observability — "flying blind" in production**

The entire AI observability market is exploding (Braintrust, Langfuse, Arize Phoenix, Fiddler, TrueFoundry, Galileo). Every article says the same thing: "When your agent fails in production, you need to answer: What decision did it make? What data did it use? How much did it cost?" Traditional APM tools weren't built for this. LLM-based agents are non-deterministic — the same prompt can return different outputs, and failures don't always throw errors.

**What this means for Realm:** Realm's evidence chain captures every step's inputs, outputs, timing, errors, and retries. The diagnostics layer records per-field extraction traces. The replay system lets developers re-run with modified parameters. This is built-in observability at the workflow level, not bolted-on monitoring.

**Pain Point 5: Governance and audit trails (required for enterprise)**

Enterprise AI requires role-based access control, audit logs, data retention policies, and compliance certifications. Gartner warns over 40% of agentic AI projects may be canceled by 2027 without governance or clear ROI. "As you move agency from humans to machines, there's a real increase in the importance of governance" (MIT Sloan). Regulated industries need a complete audit trail of AI decisions.

**What this means for Realm:** The evidence chain IS the audit trail. Every step, every decision, every human gate response, every error and retry is recorded. The run record is self-contained — it includes the workflow version, schema version, document snapshots, and every piece of evidence. This is compliance-ready from day one.

**Pain Point 6: Cost control — runaway agents burning money**

"A runaway agent loop can burn through thousands of dollars in API credits in minutes." Teams struggle to track token usage per workflow, per step, per agent. Without cost visibility, AI projects get killed when the bill arrives.

**What this means for Realm:** The step-by-step execution model naturally constrains costs. The agent only runs when the engine tells it to. Auto-execution handles engine-internal steps without LLM calls. Step timeouts prevent runaway loops. The cloud version can track estimated token usage per run for cost analytics.

**Pain Point 7: Human-in-the-loop is harder than it sounds**

Klarna's AI agent handled 80% of customer interactions — then customers complained about the lack of human fallback and the company had to reverse course. Every enterprise guide says "design choreographed workflows where AI handles routine tasks while humans remain in the loop for exceptions." But building this human-AI handoff is technically difficult.

**What this means for Realm:** Human gates are a first-class feature with gate_id binding, preview data, verified responses, and review challenges. The engine handles the state management (pending confirmation, timeout, resume) — the developer just declares which steps need human approval.

---

## Profit-Maximizing Strategy

### Principle: Sell painkillers, not vitamins

Every feature in the roadmap should address a pain point developers are actively experiencing and willing to pay to solve. The research shows the top pain is trust/verification, followed by production readiness, observability, governance, and cost control.

### Revenue model (from the design doc)

- **Free:** Open source core engine, CLI, MCP server (adoption channel)
- **$49/month:** Cloud service with cross-run analytics, version management, team collaboration
- **Custom:** Enterprise with SSO, compliance exports, SLA
- **Plugins:** $5-29 one-time (domain schema packs, adapters, processors)
- **Project bundles:** $29-49 one-time

### The key insight: Monetize the production gap

Developers build demos for free with the open source tool. When they try to go to production, they hit the wall: they need observability, governance, multi-run analytics, team collaboration, scheduled runs, and version management. That's when they pay for the cloud.

The open source tool must be genuinely useful (not crippled) to drive adoption. The cloud must solve problems the open source tool genuinely can't solve locally — not artificial restrictions, but problems that require a hosted service (cross-run intelligence, team access, scheduled triggers, persistent dashboards).

---

## Revenue-Optimized Roadmap

### Phase 1: Foundation + First Customer (Weeks 1-5)

**Goal:** Working product that solves Pain Point 1 (trust/verification) for one real customer.

**What to build:**
- Core engine with evidence chain, state machine, structured errors
- The clozr playbook extraction workflow (your existing client)
- CLI for running workflows locally
- JSON file store with versioned writes

**Revenue:** $0 (but validates the product with a real use case)

**Why this order:** You already have a paying client for the playbook updater. Rebuilding it on Realm proves the platform works and gives you your first case study. "We rebuilt our production AI workflow on Realm and went from 'hope it works' to 'proof it worked.'"

### Phase 2: MCP + Developer Experience (Weeks 6-8)

**Goal:** Any developer can connect an AI agent and run a workflow.

**What to build:**
- MCP server (6 tools)
- Protocol generation from YAML
- `realm validate`, `realm inspect`, `realm replay`
- Getting-started documentation

**Revenue:** $0 (but creates the adoption channel)

**Why this order:** Without MCP, developers can't try Realm with their existing AI tools. MCP is the integration point — it works with Claude, Cursor, VS Code Copilot, and the GitHub Copilot SDK. Maximum reach, minimum friction.

### Phase 3: Second Workflow + Launch (Weeks 9-13)

**Goal:** Prove generality, launch publicly, start building the adoption base.

**What to build:**
- Second workflow in a different domain (invoice extraction or contract review)
- Step templates extracting common patterns
- Conditional branching
- Testing package
- Blog post, GitHub public, npm 1.0

**Revenue target:** $0 direct, but aim for 500+ GitHub stars, 100+ npm installs in the first month

**The blog post angle that matches the pain:** "How I made AI agents follow a 12-step process without going off-script — and proved every output came from the source document." This hits Pain Points 1, 2, and 3 directly.

**Content marketing plan (free, high ROI):**
- Blog post on Hacker News (targets: developers frustrated with AI unreliability)
- "Why your AI agent needs an evidence chain" (targets: Pain Point 1)
- "The 80% of AI work nobody talks about" (targets: Pain Point 3, references MIT Sloan research)
- "Human gates: how to keep humans in the loop without building an orchestration layer" (targets: Pain Point 7)
- "Your RAG pipeline is lying to you — and you can't prove it isn't" (targets: every RAG developer — this is the viral angle)
- "Auditable RAG: how to prove your AI's answers came from real documents" (targets: enterprise RAG developers in regulated industries)

### Phase 4: Cloud MVP + RAG + First Revenue (Weeks 14-20)

**Goal:** $49/month customers paying for features they can't get locally. RAG support as the primary draw.

**What to build (cloud-only features that justify the price):**

**Auditable RAG — the killer feature (Pain Points 1 + 4 + 5):**

Most AI workflows in production are RAG workflows. The developer has documents, the agent searches them, and generates answers. Every existing tool (LangChain, LlamaIndex, Pinecone, Chroma) handles the retrieval. None of them handle the verification. Realm wraps the RAG pipeline in a verified execution layer:

- Vector database service adapters — Pinecone, pgvector, Chroma, Weaviate. The engine makes the search calls, not the agent. Every query, every result, every relevance score is logged as evidence.
- Quote verification against retrieved chunks — when the agent claims an answer came from a specific passage, the engine verifies the verbatim quote actually exists in that chunk. This catches the #1 RAG failure: "the AI hallucinated despite having the right context."
- End-to-end audit trail — from search query → retrieved passages → selected passage → extracted value → verbatim quote → human confirmation. This is what regulated industries (healthcare, legal, finance) need before they deploy RAG in production.
- "Auditable RAG extraction" step template — a pre-built YAML template that wraps any vector database in Realm's evidence chain. A developer adds Realm to their existing Pinecone setup in 30 minutes and gets verified, auditable RAG.

This is the highest-value feature in the entire roadmap because it makes Realm relevant to every developer building RAG applications, not just document extraction workflows.

**Cross-run analytics (Pain Point 4 — observability):**
- "78% of persist_update failures last month were SERVICE_HTTP_5XX between 2-4am" — this requires data across many runs, which a local JSON file store can't provide
- Field performance trending: which fields are consistently extracted vs which ones fail
- RAG retrieval analytics: which queries return low-relevance results, which chunks are never matched, which documents produce the most extraction failures
- Error pattern detection across runs

**Workflow version comparison (Pain Point 3 — production readiness):**
- "v1.0: 67% success, v1.1: 74% success" — compare versions with real data
- A/B testing of schema changes without manual tracking

**Team collaboration (Pain Point 5 — governance):**
- Multiple developers working on the same workflows
- Role-based access to runs and evidence
- Shared workflow registry

**Scheduled and triggered workflows (Pain Point 6 — cost control):**
- Cron-based execution: "extract fields from this document every Monday"
- Webhook triggers: "run when a new document appears in Google Drive"
- Run budget limits: "stop if estimated token cost exceeds $5"

**Dashboard (Pain Points 4 + 5):**
- Run list with status, timing, errors
- Evidence viewer: click into any run, see every step's inputs/outputs/evidence
- RAG search inspector: see every query, every retrieved passage, every relevance score
- Webhook delivery log

**Revenue target:** 10 paying customers at $49/month = $490 MRR by end of Phase 4

**Pricing justification:** A single developer spending 4 hours debugging an AI workflow that Realm's evidence chain would have explained in 5 minutes costs more than $49/month in lost time. For RAG users specifically: "the AI gave the wrong answer but I can't tell if it retrieved the wrong passages or hallucinated from the right ones" — Realm answers this question instantly.

### Phase 5: Growth + RAG Ecosystem + Plugin Revenue (Weeks 21-30)

**Goal:** Expand revenue streams, build ecosystem, make Realm the standard for auditable RAG.

**What to build:**

**RAG premium features (cloud-only, usage-based pricing):**

- Managed vector storage — developers upload documents, Realm handles chunking, embedding, and indexing. No Pinecone subscription needed for small-to-medium workloads. Pricing: $0.10 per 1K documents indexed per month. A developer with 500 documents pays $50/month on top of the $49 base — this is cheaper than running their own Pinecone.
- Cross-collection search — search across multiple knowledge bases in a single query. The audit trail tracks which collection each result came from.
- RAG quality scoring — the cloud analyzes retrieval patterns across runs: which queries consistently return low-relevance results, which chunks are stale or redundant, which embedding model performs best for the developer's domain. This is intelligence that requires cross-run data and can't be computed locally.
- Retrieval drift detection — "your query 'management fee' returned 0.94 relevance last month but 0.71 this month — your knowledge base may need updating." Alerts when RAG quality degrades.

**AI-powered diagnostics (cloud-only, addresses Pain Point 4):**
- "Why did this extraction fail?" → the cloud AI analyzes the evidence chain and explains in plain English
- "Why did the agent pick passage #3 over passage #1?" → retrieval decision analysis
- "How can I improve my schema for this document type?" → suggestions based on cross-run patterns
- This is a premium feature that competitors can't easily replicate because it requires Realm's structured evidence data

**Domain schema packs (plugin revenue, addresses Pain Point 3):**
- Real estate leasing: $19 (schema + step template + example workflow)
- Invoice extraction: $19
- Contract clause detection: $19
- RAG-powered Q&A bot: $29 (complete workflow template for building an auditable Q&A system over a document collection)
- Compliance document review: $29 (RAG workflow for checking documents against regulatory requirements)
- Each pack gets a developer from "I have Realm installed" to "I have a working pipeline" in 30 minutes
- Revenue: if 5% of users buy one pack at $19-29, and you have 1000 users, that's $950-1450

**Adapter marketplace (plugin revenue):**
- Pinecone adapter: free (drives adoption)
- Chroma adapter: free (drives adoption)
**Adapter marketplace (aligns with integration ecosystem — see design doc Part 6):**

Free adapters (drive adoption — every free adapter increases the chance a developer adopts Realm):
- Pinecone, pgvector, Chroma adapters: free (drive RAG cloud revenue)
- Postgres, Supabase adapters: free (most common developer databases)
- Slack adapter: free (human gates + notifications)
- Generic REST adapter: free (connect to any API, critical for adoption)
- Google Drive adapter: free (multi-document workflows)
- Webhook (outbound): free (already in design doc)

Paid adapters (revenue per sale, compound value):
- Salesforce adapter: $19 (enterprise CRM — high-stakes writes need verified execution)
- HubSpot adapter: $9 (SMB CRM — large developer base)
- QuickBooks adapter: $19 (financial data = highest-stakes verified execution)
- Stripe adapter: $9 (payment verification workflows)
- SharePoint adapter: $9 (enterprise document source)
- Airtable adapter: $9 (no-code developer audience)
- SAP adapter: $29 (enterprise ERP, Phase 6)
- Snowflake adapter: $19 (enterprise analytics, Phase 6)

Revenue model: each adapter makes the platform more useful → more users → more cloud subscriptions → more adapter sales. The free adapters are not charity — they're the adoption engine. A developer who connects Realm to Postgres and Pinecone for free is one successful run away from paying $49/month for the cloud dashboard.

**Domain bundles (the highest-margin item — $29-49 each):**

Bundles package adapters + schemas + step templates + example workflows into complete solutions. Developers don't buy adapters — they buy outcomes:

- "Invoice Processing Pack" ($39): PDF reader + QuickBooks adapter + invoice line-item schema + extraction step template + human review gate + example workflow. Developer goes from zero to working AI invoice extraction in 30 minutes.
- "Contract Review Pack" ($49): Document reader + RAG adapter + clause detection schema + risk scoring template + human gate for flagged clauses. For legal teams reviewing contracts with AI.
- "Customer Data Enrichment Pack" ($29): CRM adapter (Salesforce or HubSpot) + web scraper adapter + enrichment schema + merge-and-verify template. AI enriches CRM records from external sources with verified data.
- "Compliance Document Audit Pack" ($49): RAG adapter + regulation schema + gap analysis template + evidence export. AI checks documents against regulatory requirements with auditable results.
- "Real Estate Leasing Pack" ($19): Google Docs adapter + Bubble adapter + property management schema + playbook extraction template. Based on the clozr workflow — the first domain pack, built from real production experience.

Revenue: if 5% of users buy one bundle at $29-49, and you have 1000 users, that's $1,450-2,450. Bundles have near-100% margin since they're configuration files.

- Vector DB adapters are free because they drive cloud revenue (managed indexing, cross-run analytics)

**Enterprise tier (addresses Pain Point 5):**
- SSO (SAML/OIDC)
- Compliance export (SOC 2, HIPAA evidence packages) — especially valuable for RAG in healthcare and legal
- Audit log search API — "show me every time the AI answered a question about patient eligibility in the last 90 days"
- SLA guarantee
- Custom pricing: $500-2000/month depending on usage
- Enterprise RAG: dedicated vector infrastructure, data residency controls, encryption at rest

**Revenue target:** $5K MRR by end of Phase 5

### Phase 6: Scale (Weeks 30+)

**What to build based on demand signals:**

**Parallel step execution** — if users hit performance bottlenecks with sequential workflows
**Workflow composition (sub-workflows)** — if users need complex multi-stage pipelines
**Multi-agent workflows** — if users need different AI models for different steps (e.g., GPT-4o for extraction, Claude for validation)
**Real-time observability (WebSocket/SSE)** — if cloud users need live dashboards
**RAG fine-tuning pipeline** — use Realm's evidence data (successful extractions with verified quotes) to fine-tune embedding models for domain-specific retrieval. This is a unique advantage: Realm generates structured training data as a byproduct of normal operation.
**Multi-tenant RAG** — one Realm instance serving multiple customers, each with their own knowledge base, with data isolation and per-tenant billing

---

## Revenue Projection (Conservative)

| Month | Phase | Users (free) | Paying customers | MRR (cloud) | RAG revenue | Adapters + Bundles | Total MRR |
|-------|-------|-------------|-----------------|-------------|-------------|-------------------|-----------|
| 1-3 | 1-2 | 0 | 0 | $0 | $0 | $0 | $0 |
| 4 | 3 (launch) | 100 | 0 | $0 | $0 | $0 | $0 |
| 5 | 3-4 | 300 | 3 | $147 | $0 | $0 | $147 |
| 6 | 4 | 500 | 8 | $392 | $80 | $95 | $567 |
| 7 | 4-5 | 800 | 15 | $735 | $225 | $285 | $1,245 |
| 8 | 5 | 1,200 | 25 | $1,225 | $500 | $570 | $2,295 |
| 9 | 5 | 1,500 | 35 | $1,715 | $875 | $855 | $3,445 |
| 10 | 5 | 2,000 | 50 | $2,450 | $1,500 | $1,330 | $5,280 |
| 11 | 5 | 2,500 | 65 | $3,185 | $2,275 | $1,710 | $7,170 |
| 12 | 5-6 | 3,000 | 80 | $3,920 | $3,200 | $2,090 | $9,210 |

RAG revenue assumes 20% of paying customers use managed vector storage, starting at $10/month average and growing as document collections grow. Adapter + bundle revenue assumes 5% of total users buy one paid adapter ($9-19) or bundle ($29-49) per month, weighted average $19. Enterprise RAG customers ($500+/month) are not included in this table but would accelerate revenue significantly.

**Year 1 total (conservative):** ~$29K from cloud + ~$9K from RAG storage + ~$7K from adapters/bundles = ~$45K

**Year 1 total (optimistic, if a blog post goes viral or enterprise RAG customer signs):** $80-175K

The real money is in Year 2 when enterprise customers adopt auditable RAG at $500-2000/month. One healthcare company deploying RAG for clinical document search at $1500/month is worth 30 individual customers. And regulated industries (healthcare, legal, finance) are the ones most willing to pay for verified, auditable AI — they have compliance budgets.

**The domain bundle multiplier:** Each domain bundle creates a complete use case that attracts a new audience. The invoice processing pack brings accountants and finance teams. The contract review pack brings legal teams. Each audience that adopts Realm brings their own integration needs (QuickBooks for finance, Salesforce for sales, SharePoint for legal), creating a flywheel: bundles → new users → adapter purchases → cloud subscriptions → more bundles.

---

## What to Build vs What NOT to Build

### Build (addresses proven pain points):
- Evidence chain with hash verification (Pain Point 1 — THE differentiator)
- Structured error handling with agent self-correction (Pain Point 1)
- Human gates with verified responses (Pain Point 7)
- Auto-execution mode (Pain Point 2 — reduces orchestration complexity)
- Step-by-step diagnostics with replay (Pain Point 4)
- Workflow versioning with comparison (Pain Point 3)
- Auditable RAG with quote verification (Pain Points 1 + 4 + 5 — the highest-value feature)
- Vector DB adapters for Pinecone, Chroma, pgvector (drives RAG adoption)
- Managed vector storage in cloud (usage-based revenue)
- Cross-run analytics including RAG retrieval quality (Pain Point 4 — cloud-only, monetizable)
- Audit trail export (Pain Point 5 — enterprise, monetizable)

### Do NOT build (no proven demand or too competitive):
- General-purpose AI agent framework (LangChain, CrewAI, AutoGen already exist)
- AI model hosting or inference (Replicate, Together, Fireworks)
- Code generation or coding assistant (Copilot, Cursor, Kiro)
- General observability platform (Langfuse, Braintrust, Arize already exist)
- Low-code/no-code AI builder (n8n, Make, Zapier already handle this)
- A vector database (Pinecone, Chroma, Weaviate, pgvector already exist — Realm wraps them, doesn't replace them)

### The positioning that avoids competition:

"Realm is not an AI framework. It's not an observability platform. It's not a vector database. It's the verified execution layer that sits between your AI agent and your production workflow — including your RAG pipeline — and proves every output came from a real source."

The existing tools are horizontal — they work across all AI use cases. Realm is specifically for workflows where the AI reads data, transforms it, and writes results, and where you need proof that every step was done correctly. RAG is the biggest use case, and "auditable RAG" is the positioning that no competitor currently occupies.

---

## Highest-ROI Actions for the First 90 Days

1. **Week 1-3:** Build the core engine. Get one workflow (clozr playbook) running on Realm.
2. **Week 4-5:** Add human gates and auto-execution. Make the workflow production-grade.
3. **Week 6:** Build the MCP server. Connect Claude to the workflow. Record a demo video.
4. **Week 7-8:** Write the getting-started guide. Make it possible for another developer to install Realm and run a workflow in under 10 minutes.
5. **Week 9-10:** Build the second workflow. Write the blog post.
6. **Week 11-13:** Launch on Hacker News, Reddit, Dev.to. Collect feedback aggressively. Every comment is a product signal.

**The one metric that matters in the first 90 days:** Can a developer who has never seen Realm go from `npm install` to a running workflow in under 10 minutes? If yes, you have a product. If no, nothing else matters.
