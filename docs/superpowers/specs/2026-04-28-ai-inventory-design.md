---
id: spec-2026-ai-inventory
title: AI capabilities inventory for spaces
slug: ai-inventory
status: reference
created: 2026-04-28
updated: 2026-04-28
---

# AI Capabilities Inventory for Spaces

## Summary

A wide-angle inventory of where AI (RAG, LLM, embeddings, agents, ingestion) could plausibly fit into the existing Clinical Trial Status Dashboard. This is a **reference document**, not an implementable spec. It captures every surface in a space, the AI opportunities that surface unlocks, the new cross-cutting surfaces AI would create, the ingestion features that bring new data in, and the infrastructure backbone needed under all of it. A second view re-sorts the same set by quick-win to support sequencing.

This document exists so we don't lose ideas while we decide what to build first. The first feature we will spec from this is **press-release-to-event** (see "Next step" at the bottom).

## Operating Constraints

These apply to every AI feature on the menu:

- **Tenant + space isolation.** Per the whitelabel spec (`2026-04-27-whitelabel-design.md`), data does not cross tenants. RAG indices, embeddings, and LLM context windows must enforce `tenant_id` + `space_id` boundaries via RLS or application-level checks. No cross-tenant leakage, ever.
- **Provenance over fluency.** Pharma BD users will not trust uncited claims. Every generated artifact must carry `source_refs: [{table, id}]` so the UI can render "based on these rows." Default to extractive over generative; refuse to answer when no source supports a claim.
- **Speed over magic.** These users are time-pressured power users, not chatbot enthusiasts. Surfaces that take >2 seconds to first paint lose them. Cache aggressively, stream where possible, prefer Haiku-class models for classification/tagging.
- **Authority through restraint.** Match the brand: terse, factual, no playful copy, no emoji. Light mode only. Slate/teal palette. Generated text should feel like it came from an analyst, not a chatbot.
- **User in the loop by default.** AI proposes; the user commits. Autonomous data mutation is reserved for narrow, well-bounded jobs (e.g., scheduled CT.gov sync diffs). No agent silently writing rows the user didn't approve.

---

## 1. AI Opportunities by Existing Surface

### Dashboard / Timeline (`dashboard.component.ts`)

- **Diff digest** — "what changed in this view since you last opened it" (status flips, new markers, phase shifts). [easy]
- **Natural-language filter** — "Pfizer's late-phase NSCLC trials starting Q3" -> applies filters. [medium]
- **Anomaly callouts** — flag trials whose `recruitment_status` or end-date drifted on last CT.gov sync. [easy]
- **Predicted next catalyst per trial row** — LLM reads phase pattern + sponsor history, projects likely next event. [hard, hallucination risk]

### Landscape / Bullseye (`landscape.component.ts`)

- **Cluster narrative** — for any selected slice (TA x MOA x phase), generate a 2-sentence read: who's leading, what's crowded, where the whitespace is. [medium]
- **Whitespace detector** — surface MOA x indication combos with no or minimal trial activity across companies. [medium, mostly deterministic]
- **"Who looks like us"** — given a product, find strategically comparable products by MOA/ROA/phase/sponsor profile via embeddings. [medium]

### Catalysts (`catalysts-page.component.ts`)

- **Importance ranking** — LLM scores each upcoming catalyst by likely market impact (sponsor, phase, indication). [medium]
- **Talk-track per catalyst** — auto-draft 3 bullets BD can take into a meeting. [easy]
- **Inbound monitoring** — point at a sponsor's IR page or SEC filings, propose new catalysts. [hard, ingestion territory]

### Events (`events-page.component.ts`)

- **Press-release-to-event** — paste URL or text, generate `title`, `description`, `category`, `tags[]`, link to right product/trial. [easy, highest-leverage]
- **Auto-thread** — propose which existing thread a new event belongs to via embedding similarity. [easy]
- **Event source enrichment** — pull article, extract entities, attach to `event_sources`. [medium]
- **Daily/weekly digest** — LLM-written briefing of new events scoped to user's portfolio. [easy]

### Manage > Trials (`trial-list.component.ts`, `trial-detail.component.ts`)

- **Plain-English trial summary** — generate readable summary from `eligibility_criteria`, `design_*` fields, `outcome_measures`. [easy]
- **Patient population synopsis** — one-line "who's in this trial" extracted from eligibility. [easy]
- **CT.gov diff explanation** — when sync detects changes, LLM explains what changed and why it matters. [medium]
- **Trial notes synthesis** — across multiple analysts' notes on a trial, surface consensus and disagreements. [medium]
- **Suggested markers from notes** — read note text, propose marker(s) to add. [medium]
- **Bulk NCT import via paste** — paste a list of NCTs *or* free text mentioning trials, resolve to NCTs, sync. [medium]

### Manage > Companies / Products

- **Auto-generated product brief** — pull MOA, ROA, trial set, write a 100-word product summary. [easy]
- **Logo / metadata fetch** — auto-pull from web on creation. [easy, non-AI but adjacent]
- **Pipeline summary** — "Pfizer's oncology pipeline at a glance" generated from the space's data. [easy]

### Manage > Taxonomies (MOAs, ROAs, marker types)

- **Dedup suggestions** — when adding "PD-(L)1", flag existing "PD-L1 inhibitor"; offer merge. [easy]
- **Auto-classify products into existing taxonomy** — read product description, suggest MOA/ROA. [easy]

### PPT Export (`pptx-export.service.ts`)

- **Generated narration / talk track** — bullet notes per slide. [easy]
- **Audience-aware report mode** — "for board," "for BD team," "for licensing committee" -> different slide selection + tone. [medium]
- **Auto-generated exec summary slide** — 3 bullets opening any deck, sourced from current view's data. [easy]

### Space Settings / member-level

- **Onboarding tour** — AI walks a new tenant member through the space's contents in 60 seconds. [medium]

---

## 2. New Cross-Cutting Surfaces (don't exist today)

- **Copilot / "Ask this space"** — RAG chat over all space data: trials, notes, events, products. Cited answers only. [hard, marquee]
- **Semantic search bar** — replaces keyword search; works across trial notes, event descriptions, eligibility criteria. [medium]
- **Comparison mode** — pick 2-3 products or trials, generate side-by-side narrative. [easy]
- **Daily briefing email/page** — tenant-branded "what changed in your competitive landscape" digest. [medium]
- **Anomaly inbox** — passive feed of "things you should look at" (status changes, suspended trials, sponsor changes). [easy]

---

## 3. Ingestion AI (brings new data into the space)

- **Press release / 8-K parser** — paste or auto-pull, extract trials, markers, events with citations. [medium, high value]
- **News feed monitoring** — Endpoints News, FierceBiotech, BioSpace RSS -> propose new events. [hard, infra-heavy]
- **PubMed integration** — link papers to trials, auto-tag, summarize results sections. [medium]
- **Conference abstract harvest** — ASCO / ASH / ESMO abstracts -> propose events at conference dates. [hard, seasonal]
- **Patent / FDA filing watcher** — Orange Book, FDA approvals, AdComm calendar -> propose markers. [hard]
- **Email-in / drag-and-drop** — forward a PDF/article to a per-space email, AI parses and proposes edits. [medium, very pharma-friendly UX]

---

## 4. Infrastructure Backbone (universal, needed for ~everything above)

- **Embeddings store** — pgvector columns on `trials`, `events`, `trial_notes`, `products`, with RLS-enforced tenant isolation.
- **Citation layer** — every generated claim returns `source_refs: [{table, id, span}]`; UI renders inline.
- **Prompt registry** — tenant-overridable prompts (an agency might want different tone or terminology).
- **Provider gateway** — Claude for reasoning, Haiku for classification/embedding-grade tasks, separate embeddings provider; tenant routing and cost control centralized.
- **Audit log** — every LLM call logged with input/output, tenant, user, cost. Critical for pharma compliance posture.
- **Per-tenant cost caps + rate limits** — agencies will resell; protect against runaway tenant usage.
- **Hallucination guardrails** — extractive-by-default; require citations; refuse if no source supports a claim.
- **Background job runner** — for ingestion, scheduled briefings, batch embeddings. Likely Supabase pg_cron + Edge Functions.

---

## 5. Quick-Win View (re-sort of the same set)

### Pre-req shared infra (~1-2 days, pays for ~10 of the features below)

- **Provider gateway** — one Supabase Edge Function fronting Claude calls. Tenant context, cost cap, audit log baked in.
- **`ai_calls` audit table** — tenant, user, prompt name, input/output, tokens, cost, timestamp. Logged from the gateway.
- **Citation convention** — every generated artifact carries `source_refs: [{table, id}]`.

Skip pgvector / embeddings until tier 2. None of tier 1 needs it.

### Tier 1 — ~3-5 days each, low hallucination risk (rough impact order)

1. **Press-release-to-event** — paste URL or text on Events page, modal opens with extracted `title`, `description`, `category`, `tags[]`, suggested `product_id`/`trial_id`. User reviews, saves. *One prompt, structured output, user-confirmed before commit. Highest "wow per hour of build."*
2. **Plain-English trial summary** — generate "what is this trial?" paragraph on trial detail from `eligibility_criteria` + `design_*` + `outcomes`. Cached per `ctgov_last_synced_at`. *Read-only, deterministic input.*
3. **CT.gov diff explanation** — when sync detects changed fields, LLM writes "X became Y, which suggests Z" into the sync record.
4. **Talk-track per catalyst** — 3 bullets next to each catalyst row. *One prompt per row, cacheable.*
5. **Auto-generated exec-summary slide** — first slide of every PPT export auto-drafted from the deck's data. *Hooks existing pptx pipeline; no new UI.*
6. **Comparison mode** — multi-select 2-3 products or trials, side-by-side narrative.
7. **Patient-population synopsis** — 1-line "who's in this trial" extracted from eligibility on every trial row.
8. **Daily digest of new events** — cron-fired in-app card summarizing today's events, scoped to space.
9. **Taxonomy dedup suggestion** — adding "PD-(L)1" surfaces existing "PD-L1 inhibitor" with merge offer.
10. **Auto-classify product into existing taxonomy** — on product create/edit, propose MOA + ROA from name/description.
11. **Anomaly callouts on dashboard** — flag rows where last CT.gov sync changed a meaningful field.

### Tier 2 — 1-3 weeks each (gated on embeddings infra or scheduled jobs)

Need pgvector + embeddings backfill:

- Auto-thread events by similarity
- Trial-notes synthesis (consensus / disagreement across analysts)
- "Who looks like us" comparable-product surfacing
- Whitespace detector on landscape
- Cluster narrative for landscape slices
- Semantic search bar
- Suggested markers from note text
- Importance ranking of catalysts
- Cross-cutting anomaly inbox

Need scheduled jobs / ingestion plumbing:

- Bulk NCT paste import (extract NCTs from any text, resolve, sync)
- Briefing email
- Audience-aware PPT modes ("for board" vs "for BD team")

### Tier 3 — bigger plays (out of quick-win scope)

Listed for completeness:

- Copilot / "Ask this space" RAG chat
- Natural-language filter on dashboard
- Predicted-next-catalyst per trial
- News-feed monitoring (Endpoints, FierceBiotech, BioSpace)
- Conference-abstract harvest (ASCO/ASH/ESMO)
- Patent + FDA-filing watcher
- Email-in / drag-and-drop ingestion
- PubMed integration
- Onboarding tour
- Pipeline summary
- Auto product brief
- Logo/metadata fetch (non-AI but adjacent)
- Generated PPT narration / talk track

### First ship

**#1 Press-release-to-event.** Validates the gateway + audit log + citation pattern in production, demonstrates the extractive-by-default discipline, and creates an "ah-ha" moment per analyst per day. Trial summary (#2) is the lower-risk alternative if a more passive first deploy is preferred.

---

## Next Step

Brainstorm and spec **press-release-to-event** as its own design document. Open design questions to resolve before implementation:

- Input modes — paste URL, paste text, both? File upload? Server-side fetch (CORS, paywalls)?
- UX — modal? Side-panel? Full page?
- Multi-event extraction — what if one press release announces multiple distinct events?
- Source linking — does the modal show which sentences in the source mapped to which fields?
- Disambiguation — when the LLM is unsure which `product_id` or `trial_id` to attach, how does the user pick?
- Failure modes — what happens when extraction returns nothing usable?
- Provider + model — Claude Sonnet, Haiku, Opus? Single call or chained?
- Cost model — per-extract budget; tenant cap interaction.
- Prompt versioning + audit-log integration.

That spec will live at `docs/superpowers/specs/2026-04-28-press-release-to-event-design.md` (or similar) and should reference this inventory as its parent context.
