# AI and Data Expansion -- Thinking Thread

Working document. This is a strategy/brainstorm thread, not a spec. Captures where we
landed on "what is the next AI step" and "how do we expand the data the app collects."
Edit freely. When a direction here graduates to real work, move it into `docs/specs/`.

Last updated: 2026-06-05

---

## 1. Where we are today

- AI import is live: paste NCT IDs / a URL / a block of text, Claude (Sonnet 4.6 in the
  worker) extracts a structured competitive landscape (companies, assets, trials,
  markers, events), the analyst reviews it, then commits via `commit_source_import`.
- The real asset we built is an **AI execution spine**, not just one feature:
  - `ai_calls` -- every LLM call logged with outcome, tokens, cost.
  - `ai_config` -- per-tenant enable flag, daily cost cap, per-user rate limits.
  - Worker brokers Anthropic calls behind `EXTRACT_SOURCE_WORKER_SECRET`.
  - `source_documents` provenance threaded onto every row the model writes.
- Our data has the property that makes AI trustworthy: **structured and cited.** Every
  trial / marker / event traces to a source. Slide 4 of the deck says this out loud.
- Existing automated source: a daily ClinicalTrials.gov sync into the activity feed.

## 2. The AI maturity ladder (industry framing)

How SaaS products integrate AI, roughly in order of maturity and risk:

1. AI as a transform -- input in, structured output out. **(Import. We are here.)**
2. AI in the read path -- "ask your data," grounded Q&A. Read-only, low risk.
3. AI in the write path -- drafting / assisting creation (analyst notes, briefs).
4. Agentic -- model plans and executes multi-step work via tools, often unattended.
5. Interop -- expose our data as tools to external assistants (MCP).

The deck's roadmap slide already names rung 3 ("Draft, model, and ask inside Clint")
and rung 5 ("Use Clint from inside your AI assistant"). It skips the rung that makes
both real.

## 3. What "agentic" actually means in our codebase

Strip the buzzword: agentic = give the model a set of **tools** (functions it can call)
and let it decide which to call, in what order, looping until done. Our tools are RPCs we
already have (`get_space_inventory_snapshot`, trial/asset/marker queries, activity feed).

Key safety property falls out for free: tools run as RPCs, so **RLS is the permission
boundary.** The agent physically cannot read a space the user can't. The scariest part of
building agents safely is already enforced everywhere in our schema.

## 4. Recommended next AI step -- "Ask Clint" (rung 2), built agentic

User likes this idea (#1). Build a grounded in-platform assistant as a tool-calling
agent over our read RPCs. Reasons:

- Reuses the spine (same worker pattern, same `ai_call_open/preflight/close` lifecycle,
  same cost cap and rate limits). Adding one endpoint + a tool loop, not a subsystem.
- Read-only -> low blast radius; a wrong answer comes with checkable sources.
- Citations exist by construction (`source_doc_id` on every row).
- It is the substrate for everything above it: rung 3 = same loop + write tools; rung 5
  = same tool defs over MCP. Build the tool layer once, three roadmap items light up.

Model note: import uses `claude-sonnet-4-6`. For multi-step tool reasoning, benchmark
Opus on the harder queries before locking the model.

## 5. Data expansion -- the bigger idea the user wants to pursue first

Insight: we already built the destination. **Every new source is the same
`extract -> review -> commit` pipeline, with a different trigger.** Today the trigger is a
human pasting text. Tomorrow it is a scheduled connector or an agent.

### Two ingestion archetypes (the mental model)

- **Connector pull (deterministic).** Source has a clean API. Scheduled worker pulls
  structured rows; AI only normalizes/links/dedupes into the graph. Cheap, reliable,
  high-volume. Our CT.gov sync is already this.
- **Agentic pull (model-driven).** No clean API (IR pages, press releases, conference
  recaps). An agent searches, fetches, reads, extracts, cites. Pricier, handles the long
  tail no connector can.

Mature CI products run both. Both empty into the same commit RPC + provenance we have.

### Source landscape (most have free official APIs)

| Source | New signal | Feeds | Pull mode |
|---|---|---|---|
| openFDA + Drugs@FDA | Approvals, labels, recalls, FAERS adverse events | regulatory/approval markers, FDA track record | Connector |
| FDA AdComm + PDUFA calendar | Upcoming decision dates | catalysts | Connector + agentic |
| Conference calendars/abstracts (ASCO, ESMO, AACR, ASH) | Readout dates, topline results | catalysts, data markers | Calendar=connector, abstracts=agentic |
| SEC EDGAR 8-K full-text | Material events: results, deals, exec changes | events (all categories) | Connector |
| Global trial registries (EU CTR, WHO ICTRP) | Non-US trials | trials | Connector |
| PubMed | Published trial results | markers, evidence | Connector |
| Patents / FDA Orange Book | Loss-of-exclusivity, early-signal assets | LoE markers, assets | Connector |
| Company IR / press / news | Whatever the company announces first | events, markers, deals | Agentic |
| EMA CHMP outcomes | EU regulatory decisions | regulatory markers | Agentic |

### New entities worth adding (not just more rows)

The deck names BD / strategy / portfolio / **licensing** as the audience, but the schema
doesn't model the two things those people live on:

1. **Deals / transactions** (licensing, M&A, partnerships, financings). Biggest gap for
   the BD/licensing persona. Sourced agentically from press + SEC. A `deals` entity linked
   to companies and assets turns Clint from "what's in the pipeline" into "who's moving."
2. **Catalysts as first-class** (today implied by future-dated markers). A real catalyst
   object (date, confidence, source, type) unifies the FDA/conference/PDUFA feeds into the
   catalyst-tracking pillar the positioning already claims.

### The unifying agent: watchlist monitoring

Don't think of the sources as N separate features. Think of one engine: an analyst marks
a company / asset / indication as watched; on a schedule the agent pulls every relevant
source, extracts deltas, dedupes against the graph, and surfaces "what changed and why it
matters" with sources, for one-click approval. That is the agentic flagship. Source
expansion = what the engine is allowed to watch. Also the moat: the graph accumulates
cited competitive history no human team could maintain by hand.

## 6. Competitor screenshot reviewed (single-company investor terminal, ABBV)

User shared a tool that shows, per ticker: Catalysts timeline, Drug Pipeline (assets x
phases x indications), Financial Health, Volume/Price Analysis, Short Interest, FDA Track
Record, Analyst Ratings, Recent News.

Split by persona, it is two products stacked:

- **Overlaps our wheelhouse (validates our plan):** Catalysts (= markers + catalyst
  pillar), Drug Pipeline (= our assets/trials/phases/indications), FDA Track Record (=
  openFDA/Drugs@FDA connector, company-aggregated), Recent News (= events + agentic news).
- **Investor/trading desk (different persona, mostly noise for us):** Volume, Price (RSI,
  EMA), Short Interest, Analyst Ratings/price targets. Serves a stock trader, not a CI
  analyst.
  - **One exception worth stealing: Cash Runway / Financial Health.** "Can this biotech
    fund itself to its next catalyst" is a real CI signal, especially for BD. That metric
    is relevant; RSI/short-squeeze are not.

### Takeaways

- It is independent validation that Catalysts + Pipeline + FDA + News per company is the
  right data backbone.
- **Build the CI version of a per-company AND per-asset dossier, not the trader version.**
  Pull the four overlapping sections + cash runway; skip trading metrics.
- Keep our differentiators it lacks: asset-level and indication-level cuts (not just
  company), the multi-company landscape timeline, Stout's published analysis layered on
  top, and full provenance. It is ticker-bound, so it cannot represent private biotechs or
  pre-ticker assets; we can.
- The dossier is a natural home for all expanded data, and the surface that both "Ask
  Clint" and the watchlist agent feed.

## 6b. Pivot: first connector is SEC 8-K (trial results), not openFDA

After scoping openFDA, we reconsidered its value: approvals are authoritative but
**lagging** (CT.gov already shows the trial completed; the approval hit the news). CT.gov
tells you a trial completed; it does NOT tell you whether it **worked**. That result lives
in the 8-K press release, not in CT.gov or openFDA. So the first connector is an SEC 8-K
**trial-results** reader.

Why it fits better: results anchor to trials we already have (no asset-level marker
wrinkle), the NCT id in the press release is an exact match key to `trials.identifier`, the
existing data marker types (Topline / Interim / Full Data) already model a readout, and it
reuses the AI extraction pipeline + `ai_calls` spine. Outcome (met/missed) captured in
marker metadata for v1.

Spec: `docs/specs/sec-8k-results-connector/spec.md` (spec-2026-010). The openFDA spec was
retired. Deals and catalysts (PDUFA/AdComm) are the next connectors on the same framework.

## 7. Recommended sequence

1. Generalize the import commit into a reusable **source-connector framework**
   (provenance + dedup). Prove it with one source: SEC EDGAR 8-K or openFDA (free,
   structured, high-signal).
2. Add the **catalyst-shaped sources** (AdComm, conference calendars) -- catalyst tracking
   is a named pillar and currently under-fed.
3. Layer the **watchlist agent** to turn passive sync into proactive "what changed."
4. Build **company/asset dossier** views as the aggregation surface.
5. Then **"Ask Clint" (#1)** -- it lands far stronger on a richer, self-updating graph.

Note: feeding the graph before building the assistant makes the assistant more impressive
on day one.

## 8. Open questions to resolve before any spec

- Which directions to prioritize: regulatory+catalyst feeds / financial+BD signals /
  broader trial+science / watchlist agent first.
- Build philosophy: connector framework first vs one vertical slice end-to-end.
- Is `deals` a committed new entity for the BD/licensing persona?
- Dossier scope: company-only first, or company + asset together?
- Persona guardrail: confirm we deliberately exclude trading-desk metrics.
