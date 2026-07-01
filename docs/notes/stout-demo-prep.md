# Clint × Stout — Live Demo Prep (canonical)

Prep + run sheet for the live Wednesday walkthrough with **John (MD)**. Sam (lead analyst) is your champion. The deck went ahead by email (no pricing slide on that link); Wednesday is the live demo driven off **real prod data** under a Pfizer whitelabel.

This supersedes the earlier `stout-demo-prep.md` cue pack. The *strategy* there is intact; everything factual here is rebuilt against what is actually deployed (terminology, surfaces, the seeded spaces).

**How to use:** Read Parts 1–4 until the flow is automatic — retrieve, don't recite. Only the **★ lines** are word-for-word. Parts 5–9 are live reference. Part 10 is the role-play brief for practice.

---

## Part 0 — Pre-flight checklist (do this before the call)

- [ ] Two windows arranged: **deck** (left/secondary) and **Chrome on the app** (primary). Know your switch cold (`Cmd+\`` or `Cmd+Tab`).
- [ ] Deck open at **`https://clintapp.com/internal/stout-intro.html?present`** — the `?present` flag is what includes the pricing slide. Leave it on **slide 1**.
- [ ] Logged into the app as **aadityamadala@gmail.com** (owns every demo space). Cross-subdomain cookie covers `*.clintapp.com`, so bi/pfizer subdomains are already authed.
- [ ] **Five tabs pre-opened** to avoid live navigation (URLs in Part 3). Especially: S0 timeline, the empty space's Import, the Pitch bullseye, and the 1-Year Intelligence Feed.
- [ ] Daily CT.gov sync note: timestamp shows in the timeline header ("Last CT.gov sync …") — good live proof.
- [ ] If doing the **live import** (Act 1), have the NCT list / a press-release URL ready in your clipboard, and the pre-built Pitch space as the fallback if the AI call is slow.

---

## Part 1 — The spine (one screen)

**Throughline (★ — memorize):**
> ★ "The same asset that wins the client is the one that keeps them."
> ★ "Lower cost to win, higher cost for the client to leave — from one investment."

**The flow:** `Problem → WIN → [the build, live] → RUN → KEEP → SCALE → Ask`

The four stages, one line each:
- **WIN** — walk into the pitch with the client's whole landscape already built, in their brand. The pitch *is* the product.
- **RUN** — analysts stop assembling, start interpreting. Same hours, moved to the read worth paying for.
- **KEEP** — a live, annotated view that compounds. A year of your thinking lives there. Hard to walk away from.
- **SCALE** — fully managed; grows with your book, and the accumulated data becomes Stout's asset.

**The peak is the *connection*, not a stage** — the moment the freshly-built pitch landscape visibly becomes the year-deep annotated one. Slow down across the space-switches. Everything else moves fast.

---

## Part 2 — The open (origin-anchored)

Tell it as **your** observation — you're the outsider who saw it. That's your authority. Offer the stickiness/scale thesis as a hypothesis ("you'll know this better than me, but the pattern I think it points to…"), never as something you and John already agreed.

**Cue sequence:**
- Who I am — solutions engineer; I kill manual, repetitive data workflows for a living.
- The spark — watched Sam hand-build a **timeline of trials and events**; as an outsider, captivating.
- Looked at *how* — CT.gov pulled by hand → clean → massage → place → **repeat every interval**.
- "That's literally what I optimize. There's got to be a better way."
- Started simple — automate the pull → then: what if the PowerPoint timeline were **high-fidelity, live, and interactive**.
- Widened (Sam + industry research) — everything in CI ships as a **PowerPoint**, stale the second it's sent.
- ★ "You don't hand a trader last Friday's report and ask for a buy or sell — you give them a Bloomberg terminal, live to the second. Why is CI still the Friday report?"
- The creed — data flows live · the landscape is there in a moment · the **rote** read is computed so the analyst's time goes to the **real** read.
- The synthesis (your framework, your words) — a fresh take on how a firm **wins** engagements, **runs** them, builds **trust + stickiness**, and **scales** — throughput, new deliverables, new products on the data you accumulate.
- ★ "The same asset that wins the client is the one that keeps them. Lower cost to win, higher cost to leave — from one investment."
- Hand to demo (bookend) — ★ "Let me show you — starting with that same kind of timeline, except now it builds itself."

**Tone guardrails:** exploratory, peer-to-peer; the auto-computed read **frees** the analyst, never **replaces** Stout ("the tool does the mechanical read so your people do the read worth paying for"). No "cheaper / fewer hours" — ever.

**Tight 40-sec version:** solutions engineer · saw Sam hand-building a timeline from CT.gov · "that's what I optimize" · everything ships as a stale PPT · ★ Bloomberg line · built the live version for how CI engagements actually run · ★ throughline · "let me show you — same chart, but it builds itself."

---

## Part 3 — The harness: the space ladder (real prod URLs)

The demo is driven by navigating a ladder of **pre-seeded prod spaces** — no live data pushes, nothing to break. The only genuinely live action is the optional Act 1 import. Switching spaces *is* the "time passing" effect; narrate it and it reads like a live load.

**Deck:** `https://clintapp.com/internal/stout-intro.html?present`

**S0 — Boehringer Ingelheim · Obesity (the open tie-in)**
`https://bi.clintapp.com/t/c747dd15-a176-4edb-acb2-8c716ea1fd4b/s/4fd154ce-7c85-475f-a47f-a244d80509a8`
(13 companies, 22 assets, the full GLP-1 race. Append `/timeline`.)

**Pfizer tenant (the pitch story) — `pfizer.clintapp.com/t/a87a88ae-1b76-4c6b-85e0-1b53c926d0f2/s/<id>`**
| Space | id | Role | Density (co/asset/trial/event/intel/mat) |
|---|---|---|---|
| NSCLC ADC — New Space (empty) | `5dbea303-160c-43e0-b149-8bf0266b696e` | Act 1 live-import canvas | empty |
| NSCLC ADC — Pitch | `373a85f9-2417-49f7-b28e-7de9c1b7d326` | WIN — pitch-ready | 5 / 7 / 13 / 51 / 4 / 0 |
| NSCLC ADC — 3 Months In | `39736f76-af54-486d-b05f-ae7f9c558448` | RUN / early compounding | 9 / 15 / 21 / 81 / 6 / 2 |
| NSCLC ADC — 1 Year In (Renewal) | `7f642772-5578-4635-899a-22860c6b7299` | KEEP — renewal climax | 15 / 24 / 30 / 169 / 12 / 5 |

The 1-Year slice reads at obesity-seed density: hero is the **Pfizer sigvotatug-1L interim (Jul 15)**, not a trial-end; "Next 90 days", "What changed (7d)", and "Recent materials" are all populated; events carry the full `c`/`p`/`f` projection-tier and fuzzy-date variety. Seed scripts + run command: `docs/notes/stout-demo-harness/` (`wipe-reseed-v2.sql`).

Surface suffixes on any space: `/timeline` · `/bullseye` · `/heatmap` · `/future-events` · `/intelligence` · `/activity` · `/materials` · `/profiles/{companies,assets,trials}` · `/import`.

---

## Part 4 — The run sheet (Act 0 → Ask)

Each act: **where you are · what you do · what you say · how you transition.**

### Act 0 — Open (deck slides 1–2)
- **Where:** deck, slide 1 → 2.
- **Do:** deliver Part 2. Don't read slide 2's six cards — let them sit behind you as proof the product is real.
- **Transition (★):** "Let me show you — same kind of timeline, but it builds itself." → `Cmd+Tab` to the app on **S0 timeline**.

### Act 0.5 — The story tie-in (app: S0 timeline)
- **Where:** `bi.clintapp.com …/timeline` (Boehringer · Obesity).
- **Do:** this is Sam's chart, alive. Point at the **AT A GLANCE** auto-read ("Eli Lilly leads: 4 assets, 8 at Phase 3 … Novo Nordisk most active"). Change one filter (e.g. Phase → P3) and watch the read **rewrite itself**. Note "Last CT.gov sync" in the header.
- **Say:** "Every dot is a dated event, every bar a phase, kept current by a daily ClinicalTrials.gov sync. The plain-English read at the top is computed — that's the rote read done for you."
- **Constraint:** stay on the timeline here. Don't tour the rest of BI; this space is only the tie-in.
- **Transition:** "That's a mature, year-deep engagement. Let me show you where one *starts* — from nothing."

### Act 1 — WIN, from nothing (app: empty space → Import)
- **Where:** Pfizer **NSCLC ADC — New Space** → `/import`.
- **Do:** paste a few **NCT IDs**, then a **press-release URL** or **text** block. Show the AI proposing companies/assets/trials/events, **provenance on each**, review-before-commit. Commit; pop to `/timeline` and watch it populate.
- **Say:** "Hours of blank-page setup, gone. The analyst starts from a working competitive picture."
- **Fallback:** if the AI call is slow/odd, narrate it and cut to the pre-built **Pitch** space ("here's the same thing a day or two of work later") — the next act anyway.

### Act 2 — WIN, the pitch setup (app: Pitch space + the whitelabel)
- **Where:** Pfizer **NSCLC ADC — Pitch** (`/` home, then `/bullseye`).
- **The why-now (★, say it calmly — not dramatic):** "Last week Pfizer's lead lung drug missed its main endpoint, so now they're working out the pivot. That's a competitive question at heart — and a natural moment for an engagement like this to start." (Real: sigvotatug vedotin / SigVie-002 OS miss, Pfizer press release Jun 21 2026. The trigger is genuine and ~a week old.)
- **Story:** "Your analysts are pitching Pfizer — different world from obesity. Non-small-cell lung cancer, the antibody-drug-conjugate race. They spun up a Pfizer-branded space and worked it for a day or two." Point at the **Pfizer brand + 'Intelligence by Stout'** in the header (the whitelabel).
- **Do:** on **Home**, show "Latest from Stout" — pre-written intelligence already on the field (the SV-miss read). Then **Bullseye** — the pitch hero. Switch **GROUP BY → Mechanism of Action**: "this is which *science* is winning — TROP2 vs HER2 vs integrin-β6." Note the events that are **analyst-authored, not just CT.gov**.
- **Land:** "The pitch *is* the product. And whatever wins it *is* the kickoff baseline — nothing rebuilt."

### Act 3 — RUN (one beat)
- **Where:** stay in Pitch, or flip to **3 Months In** to show early accumulation.
- **Say:** "Remember Sam's manual assembly? Gone. The AI builds the baseline; analysts start at interpretation." 
- **Reframe (critical):** **redeployment, not reduction** — same billable hours, moved to judgment. Never "cheaper / fewer hours."

### Act 4 — KEEP (app: 1-Year / Renewal space) — THE PEAK
- **Transition (★):** "Now — this exact engagement, a year in, at renewal time, looks like this…" → switch to **NSCLC ADC — 1 Year In (Renewal)**. Same environment, nothing rebuilt.
- **Where:** `/intelligence` (Intelligence Feed).
- **Do:** "Latest from Stout" — **a full year of dated briefs, newest first** (SV subgroup, sac-TMT raises the bar, Datroway, Enhertu, Emrelis…). Toggle **SHOW → All** to interleave events with intelligence. Open the lead SV brief on its asset page — point at the **version badge (V3)**: "three published revisions of this read, every one kept."
- **Say:** "It's bid season; Pfizer is evaluating tools. A year of annotated work and its history lives here, live. That's what's hard to walk away from." → ★ "The same asset that wins the client is the one that keeps them."
- **Note:** the granular word-level diff view sits behind the version history; if you want to show it, confirm the exact affordance in a dry run first — otherwise the V3 badge + dated feed already prove "every version kept."

### Act 5 — SCALE (mostly narrated; deck slide 4 supports it)
- **Where:** you can flip to deck **slide 4** (AI roadmap) — it now carries a second "Further out" track: **"A dataset that compounds into new products."**
- **Say:** longitudinal data not possible before — a year+ of briefs, events, and **event history**: e.g. a competitor's PDUFA-to-market velocity, launch resourcing, even promotional spend. Export to your AI tools / structured Excel; and over time Clint builds the warehouse over structured *and* unstructured multimodal content (docs, PDF, PPT, Excel) with cross-modal analysis.
- **Honesty line:** "You're accumulating that asset now; what you build on it later is the upside." (collection = live; new products = roadmap.)

### Act 6 — Close: enterprise, trust, roadmap (deck slides 7 → 4)
- **Where:** deck **slide 7** (trust). 
- **Say:** scalable enterprise product with zero dev/infra burden — Clint runs the syncs, infra, security. **Per-client and per-space firewalling** (one engagement never sees another's — the same isolation that lets these demo spaces sit safely next to real ones). Encrypted daily backups across two clouds, restores rehearsed. Deeper whitelabel + custom domains for agency or client available. Weave the **AI roadmap** (deck slide 4) here if not already.

### Act 7 — Pricing, then the Ask (deck slides 8 → 9)
- **Pricing (deck slide 8, the one `?present` adds):** give it **once**, then stop. $25K/space/year; volume **$25K → $21K → $18K**; unlimited users; bundles into the fee, never a client-visible line item. Anchor before he benchmarks: "less than one Evaluate seat; a fraction of one engagement's budget."
- **The ask (deck slide 9):** access this week on a **real engagement, not a sandbox** · pick one deal you're running now, stand it up together on your data · shaped around Stout, your priorities on the roadmap.
- ★ "Want to put it on one engagement and see?" → **then stop talking.**
- **Not asking for** (only if it comes up): a contract, exclusivity, or a procurement decision today.

---

## Part 5 — Objection bank (Q → cue)

- **"Won't the client see how the sausage is made and stop needing us?"** → assembling the picture was never the value; the read is. A live view makes Stout *more* present (every week vs. quarterly). Switching cost goes **up**, not down.
- **"Saves analyst time = we bill fewer hours."** → redeployment, not reduction. Same hours, moved off assembly onto judgment, pitches, client time — the work that justifies the fee.
- **"Why not just build it?"** → ~$2–4M, 2 years, and a product team in pharma tooling — not Stout's edge. Or start next week and keep your people on client work. Build-vs-buy is about focus.
- **"What does it cost?"** (once, then stop) → $25K/space/yr → $18K at volume; unlimited users; no seats, no minimum; bundles into your fee.
- **"Is this real or screenshots?"** → live, deployed, multi-tenant, real data, daily CT.gov sync (point at the timestamp). Only the two roadmap AI items aren't live; one-paste import is.
- **"Your involvement / stake?"** (don't volunteer) → yes, small advisory stake; the intro's happening because Sam thinks it's the right tool. Move on.
- **"Data quality / a wrong date?"** → confirmed vs projected is flagged everywhere (filled vs hollow glyph); every entry traces to its source; analyst reviews AI output before it commits.

---

## Part 6 — Pricing facts (verbal; not on the emailed deck)

- **$25,000 / space / year.** A space = one client engagement.
- **Volume:** 1–5 = $25K · 6–12 = $21K · 13+ = $18K each.
- **Unlimited users** — your team + the client's. No per-seat, no firm license, no minimum.
- Total only rises when you add a space. Frames as a **30-day pilot** to start (bridges to the ask).
- Anchors if pushed: less than one Evaluate seat ($20–50K); a fraction of one engagement's budget ($100–200K).
- Pricing slide is presenter-only (`?present`); the emailed link has none.

---

## Part 7 — Surface reference (what's on screen, current terms)

Nav, per space: **Landscape** (Home · Timeline · Bullseye · Heatmap · Future Events) · **Intelligence** (Intelligence Feed · Engagement · Activity · Materials) · **Profiles** (Companies · Assets · Trials).

- **Home** — the morning screen: next event, pulse stats (P3 readouts 90d / events 90d / new intelligence 7d / trial moves 30d), Latest from Stout, what changed, next 90 days.
- **Timeline** — every trial on one axis, grouped Company→Asset→Trial; color = event category, **fill = confidence (filled = confirmed, hollow = projected)**; dashed line = today; the **At a glance** auto-read in plain English. Export → PPT.
- **Bullseye** — distance to center = closeness to market; rings = phase, wedges = GROUP BY (Company / MoA / Indication / RoA / Asset). Switch to **MoA = which science is winning.** The pitch hero.
- **Heatmap** — crowding vs. white space (rows × phases). The BD/licensing view.
- **Future Events** — chronological watch list; confirmed vs projected. Export → Excel.
- **Intelligence Feed** — "Latest from Stout": published intelligence **and** events interleaved, newest first; filter Intelligence/Events; count unit = **entries**. Drafts are Stout-only; client sees published.
- **Engagement** — a space-wide intelligence write-up ("Intelligence for the whole space"). Appears once one exists. (Optional beat.)
- **Activity** — read-only log of **detected changes** (CT.gov registry deltas + analyst edits), newest first. The "always current, no busywork" proof.
- **Materials** — deliverables filed against the entities they cover. (Demo spaces are light on files — show the panel exists; don't open a file.)
- **Import** — paste NCT IDs / URL / text → AI proposes companies/assets/trials/events with provenance, review before commit. The live AI feature.
- **Whitelabel** — Agency (Stout Strategy) → Tenant (Pfizer / BI) → Space (engagement). Client brand foreground, "Intelligence by Stout" in the header on every screen.

Vocabulary to match the screen: say **events / glyphs** (not "markers"/"catalysts"), **Future Events**, **Intelligence**, **Activity**, **At a glance**.

---

## Part 8 — Domain cheat-sheet (NSCLC ADCs)

**Talk-to-it blurb (read once, speak to it):** "The NSCLC antibody-drug-conjugate race is consolidating fast. AstraZeneca and Daiichi are out front with two approved drugs and the deepest first-line pipeline, and Merck's sac-TMT just became the first ADC-plus-immunotherapy combo to win in first-line lung cancer. The hard news for Pfizer: sigvotatug vedotin just **missed its primary survival endpoint** this June, so its path now runs through a narrow subgroup and an unproven first-line combination — in a lane where competitors are already ahead. The question for Pfizer is whether to double down on the integrin-β6 science in 1L combinations, or pivot to a biomarker niche the way Enhertu and Emrelis did."

**The players (5 companies / 7 assets in the seed):**
- **Pfizer — sigvotatug vedotin** (integrin-β6 ADC). The home asset; **SigVie-002 OS miss, Jun 2026**. Future = 1L + pembro combo.
- **AstraZeneca — datopotamab deruxtecan (Datroway, TROP2)** approved EGFR 2L; broadest 1L program (TROPION-Lung07/08). **trastuzumab deruxtecan (Enhertu, HER2)** — approved HER2-mut, the niche-done-right.
- **Merck — sacituzumab tirumotecan (TROP2)** — first ADC+IO to hit a 1L primary (OptiTROP-Lung05). **patritumab deruxtecan (HER3)** — BLA withdrawn after OS miss.
- **AbbVie — telisotuzumab vedotin (Emrelis, c-Met)** — approved c-Met-high niche.
- **Gilead — sacituzumab govitecan (Trodelvy, TROP2)** — EVOKE-01 OS miss.

**The read in one breath:** AZ/Daiichi own the category; the unclaimed prize is **1L ADC+IO**, and sac-TMT proved it first; the 2L monotherapy lane is a graveyard (three ADCs failed docetaxel on OS); biomarker niches (HER2-mut, c-Met-high) are the only reliably approvable ground. Pfizer is the wounded leader.

**Glyph reading:** color = category (green data/readout, slate trial milestone, orange regulatory, blue approval, violet launch, amber LOE); **fill = confirmed; hollow = projected**; a small `f`/`c`/`p` badge marks the projection tier.

---

## Part 9 — Known rough edges / steer-arounds

- **Live import (Act 1)** is the only failure-prone moment — have the pre-built Pitch space as the instant fallback.
- **Word-level version diff** — the V3 badge proves history; confirm the exact diff-panel affordance in a dry run before relying on it live. Default to the feed + version badge as the KEEP proof.
- **Materials** are light in the seed — show the panel, don't open a file (no blob behind it).
- **Bullseye hover tooltip** can cover the chart — click the dot for the detail panel instead.
- **Pricing slide** only exists with `?present` — verify the URL before you start.
- Pitch/3mo/1yr are the **same engagement at three times**; say "the same space, a year later" when switching so it reads as time passing, not a different demo.

---

## Part 10 — Mock-demo role-play brief (paste-to-Claude to rehearse)

> You are **John, an MD in Stout's Health Care strategy practice.** I am Aaditya, founder of Clint, on a 30-min call Sam set up. Use this document as ground truth.
>
> Play John: smart, time-pressured, numbers-oriented, polite but hard to impress. You benchmark against Evaluate/Citeline and against building in-house. You care most about **differentiation** vs other strategy firms and **stickiness/retention** on big engagements, and you quietly worry a live platform lets clients "see how the sausage is made." You bill hours, so "saves analyst time" reads as "bills fewer hours" unless I frame redeployment — probe that if I slip. You know the *business* of consulting cold; you don't know NSCLC better than me.
>
> Run it: react to my open with 1–2 skeptical questions; push on weak transitions and vendor hype ("so what does that get *me*?"); fire 2–3 objections from Part 5, escalating each round; catch me if I call a roadmap item "live" or over-promise the version-diff. Near the end, decide whether you'd green-light a one-engagement pilot and say why.
>
> Then break character and score me 1–5 with one concrete fix each: (1) did the open land the problem before the product? (2) was the WIN→KEEP space-switch clear and well-timed? (3) did I keep RUN/SCALE short and protect the peak? (4) objections handled without defensiveness? (5) exploratory/peer, not salesy? (6) closed on the ask then stopped talking?
>
> Difficulty: Round 1 warm/curious; Round 2 skeptical, benchmarks hard on price + build-vs-buy; Round 3 cold, interrupts, asks the sausage-making question pointedly. Tell me the round, then begin.
