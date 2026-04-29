# Stout -- Positioning, Pricing, and Sales Notes

Working document. Edit freely as we sharpen the pitch.

---

## 1. Context and framing

### Origin

- Partner at Stout (Competitive Intelligence practice, ownership stake in the firm) flagged the recurring pain points in CI work and suggested someone should build a tool around them.
- User (me) took the suggestion and built Clint independently. Code, platform, brand, and IP belong to me.
- Partner's contribution is ideation, domain validation, and ongoing advisory -- not co-development.

### IP ownership (clean)

- Code, copyright, trademarks, data model, and platform = user.
- Partner's contributions = ideas and pain-point articulation. Under US IP law, ideas are not protectable -- implementation is. So nothing the partner has contributed creates a Stout claim on the asset. But "what's legally protectable" is not the same as "what avoids future drama."
- **Risk:** if Clint becomes valuable and Stout was never formally walled off, someone at Stout could argue (informally, equitably, or in court of public opinion) that the asset was incubated using firm context. That argument doesn't have to be legally sound to be expensive.
- **Mitigation:** before any Stout-side conversation, user and partner sign a founder/advisor agreement that makes the structure explicit:
  - User is sole IP owner.
  - Partner is an advisor with [X]% equity (or revenue share, or option pool) vesting over [Y] years.
  - Partner contributed *ideas and validation*, not Stout-paid work product.
  - No Stout time, Stout systems, Stout client data, or Stout deliverables were used to build the platform. Confirm in writing.
- This paper trail is cheap insurance and it's also what makes the COI disclosure (next) credible.

### Conflict of interest

- Partner has Stout equity (existing) and will have Clint upside (new).
- The COI is real. It is also routine in any insider-channel B2B sale. The way to handle it is disclosure, not concealment.
- **Standard handling:**
  - Partner discloses Clint economic interest to the MD on the record, in the first conversation. Not buried, not hinted at.
  - Partner does not negotiate Stout-side pricing or terms. Partner makes the introduction; user (or a third party) negotiates.
  - Partner recuses from any internal Stout decision meeting where the Clint deal is evaluated.
- **Why disclosure helps the pitch, not just the partner:** "I have a stake in this and I'm bringing it to you anyway because I think it's right for the firm" is a stronger frame than a salesperson cold-calling. The MD is being told this is an insider's recommendation made transparently.

---

## 2. Talking points for the partner -> MD conversation

This is the brief the partner uses, not the deck the MD reads.

### Tone

- **Exploratory, not sales.** "Want to show you something I've been thinking about" beats "want to pitch you a product."
- **Insider-to-insider.** The MD will respond to a peer asking for 30 minutes, not to a vendor demo.
- **Honest about state.** Underpromise. The asset is real but early; the value is in where it can go with Stout's input.

### The flow (in order)

**1. Open with the gap, not the product.**
- "We've talked before about how much time the CI team burns on assembly before we get to the strategic read. Same pattern across engagements -- outsourced summarization, decks that go stale in three weeks, no shared institutional memory between deals."
- This anchors the conversation in a problem the MD already feels.

**2. Frame the origin honestly.**
- "I floated the idea a while back. [User] is the one who actually built it. He owns the IP. I've been advising and I'll have a small stake in it -- want to be upfront about that before I show you anything."
- This is the COI disclosure. Get it on the record in sentence two.

**3. What it is, in one sentence.**
- "It's a pharma competitive intelligence platform with structured pipelines, catalysts, and trial data -- designed so analyst time goes to the strategic read instead of the assembly, and built whitelabel so we can put Stout's branding on the surface our clients see."

**4. What's built today (no overselling).**
- Live multi-tenant platform with agency, tenant, and engagement-level branding plus custom domains.
- Structured event model: catalysts, regulatory actions, approvals, label changes, deal activity -- typed, timestamped, source-cited.
- AI-ready data layer that plugs into briefing, summarization, and analysis workflows without a corpus rebuild per engagement.
- [Be honest about gaps: data coverage scope, therapeutic area depth, SOC 2 status, audit trail. Naming the gaps up front buys credibility.]

**5. Where it fits at Stout.**
- *Internal:* compresses the assembly portion of CI engagements; analyst time shifts to interpretation.
- *Client-facing:* deliverable becomes a Stout-branded live environment the client logs into between briefings, not a static deck.
- *Strategic:* puts Stout ahead of where the rest of the advisory market is on AI-ready CI data. Differentiated artifact in the pitchbook.

**6. The ask.**
- A 30-minute walkthrough with [user].
- If it lands, scope a paid pilot on one live engagement.
- *Not* asking for: a procurement decision, a contract, an exclusivity discussion in this meeting.

**7. The soft "why now."**
- "He's going to keep building this. I wanted Stout to have first look before he takes it anywhere else." Don't threaten -- just signal the optionality is real.

### What NOT to say in the first conversation

- **No price.** The MD will instinctively benchmark to Evaluate ($20-50K/seat, $100K+/yr enterprise). Pricing comes after they've seen the product, not before.
- **No exclusivity offer.** That's a structured discussion after pilot, with the right people in the room.
- **No downplaying the COI.** Disclose, on the record, in the first three minutes. If it comes out later, the deal is contaminated.
- **No "we're talking to your competitors."** Even if true. The whole point of going through the partner is that this is offered to Stout first.

---

## 3. Engagement structures -- license through acquisition

The grey area is real: partner needs Stout to win this so the asset doesn't go to a Stout competitor; user needs to retain IP and pharma-direct upside; Stout needs enough exclusivity to feel they're getting something a competitor can't have.

### Options matrix

| # | Option | Structure | Cost to Stout | What Stout gets | What user keeps | COI / IP notes |
|---|---|---|---|---|---|---|
| 1 | **Annual license, non-exclusive** | Practice or firm license, no exclusivity | $75K--$500K/yr | Internal use + whitelabel for clients | Right to sell to anyone | Cleanest. Lowest COI exposure. Stout's competitors can also buy it -- that's the trade. |
| 2 | **Category-exclusive license** *(recommended)* | License + exclusivity within the *advisory/consulting* category for 2--3 years | License + exclusivity premium ($150K--$500K/yr on top of base) | Same as #1, plus no peer advisory firm (A&M, AlixPartners, FTI, Houlihan, Big Four advisory) can buy it during the term | Pharma/biotech direct sales remain open -- the larger TAM anyway | Solves Stout's competitive moat without surrendering pharma TAM. IP unchanged. Carve-out language matters. |
| 3 | **Vertical-exclusive license** | Stout exclusive across all advisory verticals (consulting, IB, PE) for N years | Higher premium than #2 | Broader exclusivity | Pharma/biotech direct only | Over-broad. PE/IB shops aren't competing with Stout on CI engagements anyway, so the marginal value over #2 is small. |
| 4 | **Strategic investment + preferred license** | Stout takes minority stake (10--25%); license at preferred rate; observer board seat | Equity check + reduced license fee | Equity upside + influence + first-mover internal use | Operational control + ability to sell broadly | Aligns long-term incentives. Increases COI surface (partner now has three economic interests) but fully disclosed. Structure as cash-for-equity, never IP-for-equity. |
| 5 | **Acquisition / acquihire** | Stout acquires Clint outright; user joins or licenses back | $X--$Y total | Full control, full IP | Cash + earnout, role at Stout | Cleanest post-deal COI (everyone aligned). Worst for upside (one buyer's ceiling). Loses pharma-direct optionality. Almost certainly the wrong move pre-revenue. |
| 6 | **Joint venture** | Co-owned entity sells into both markets | Setup + revenue split | 50% upside, brand association | 50% upside, partial control | Slow, expensive to structure, governance complexity. Skip absent strategic reason. |

### Recommended sequence

1. **Pilot first.** Fixed-fee paid pilot on one Stout engagement, 60--90 days, ~$25K--$50K. Surfaces real value and real gaps. Gives both sides something concrete to negotiate against.
2. **Convert to Option 1 (annual license)** with an attached **90-day exclusivity option** -- Stout has 90 days post-pilot to elect Option 2 (category exclusivity) at a defined premium. This is the wedge: Stout knows exactly what it costs to lock out competitors and chooses whether to pay.
3. **Defer Option 5 (acquisition) until Year 2 minimum.** The asset is too early-stage to price correctly. Pre-revenue acquisition pricing anchors on cost-to-build, not strategic value -- a bad trade for user.

### Exclusivity without losing IP -- the playbook

- **License the right to use, never the IP itself.** Standard SaaS framing: Clint retains all IP; Stout receives a non-transferable, non-sublicensable right to use within agreed scope.
- **Whitelabel != IP transfer.** Stout's branding sits on the surface clients see. The platform, code, data model, and brand below the whitelabel stay with Clint.
- **Exclusivity is a contract term, not an IP transfer.** Plain-language clause: "Clint will not sell or license the platform to other firms in the [defined advisory category] during the [2--3 year] exclusivity period." Time-bound, category-bound, fully reversible.
- **Reverse termination right.** If Stout fails to renew or fails to hit a defined usage minimum, exclusivity lapses immediately. Protects against the "Stout buys exclusivity, parks the asset, kills its market" failure mode.
- **Carve-outs from day one.** Pharma/biotech direct sales are explicitly permitted. Non-overlapping verticals explicitly permitted. Define the category narrowly: "global advisory firms whose primary service offering includes pharma transaction support, valuation, or competitive intelligence consulting."
- **No source code, no data ownership transfer.** Even under exclusivity. Stout gets access to use the platform, not access to fork it.
- **Founder agreement first.** Before any Stout-side conversation. User-and-partner agreement makes IP ownership explicit and documents the partner's contribution as advisory, not work-for-hire. This neutralizes any future "Stout incubated this" claim -- because there's a paper trail showing IP was always user's.

---

## 4. The product, in talking points

Use these when the partner walks the MD through what Clint actually is. Two clusters: what it is, and what it means for Stout.

### What Clint is

- **Pharma-native data model.** Pipelines, assets, clinical trials, catalysts, and portfolios are first-class objects -- not free-text notes or PDF dumps.
- **Event-centric.** Every meaningful change -- data readouts, regulatory actions, approvals, label changes, deal activity -- attaches to the right asset as a typed, timestamped, source-cited marker.
- **Built for instant parsing.** Visual phase bars, color-coded event markers, and a company-and-product hierarchy that lets a reader land on the competitive read in seconds, not minutes.
- **Structured underneath, not just on the surface.** The interface is one consumer of the data; exports, briefing decks, client notices, and AI workflows are others. Same source of truth.
- **AI-ready by construction.** Because events are normalized and citation-backed, the data drops into retrieval, summarization, and analysis pipelines without the cleanup tax that ad-hoc research libraries always require.

### What it means for Stout

- **Live data access.** The competitive landscape on any asset or therapeutic area is current as of the latest event ingested. Analyst time shifts from assembly to interpretation -- the strategic read is built on a surface that is never stale.
- **AI-ready feeds Stout's own workflows.** Competitive briefs, catalyst summaries, scenario analysis can be generated directly from Clint's structured data without rebuilding a corpus per engagement.
- **Whitelabel end to end.** Multi-tenant architecture supports agency, tenant, and engagement-level branding plus custom domains. Stout delivers a fully branded competitive intelligence environment per client.
- **Cadence shift.** Converts recurring CI and MI work from a deck-and-document cadence into a living, branded platform engagement, with Stout's strategic analysis layered on top of a surface clients can interrogate any day of the quarter -- not just on delivery day.
- **Differentiated artifact.** Nothing in the advisory market today combines Evaluate-grade data structure with whitelabel and AI-readiness. Stout would be first.

---

## 5. Supporting context

### 5a. The "won't clients see how the pudding is made?" question

#### The risk

- The deck was never the value -- it was a proxy for it. What clients pay for is judgment: which competitors matter, which catalysts move the thesis, what to do about it.
- A live platform commoditizes the assembly work (gathering, summarizing, formatting). It does not commoditize the strategic read -- unless Stout was only ever delivering assembly work.
- If the strategic read is real, the live platform makes it more visible, not less.

#### How to make Stout's IP visible inside the platform

- **Curation as a deliverable.** Watchlist, competitor set, asset prioritization, therapeutic-area framing -- Stout's domain expertise applied to a generic data layer.
- **Annotation as a deliverable.** Every meaningful event carries a Stout note: why it matters, what it shifts, what it implies.
- **Strategy surface as a deliverable.** Scenario analysis, deal implications, recommendations -- alongside the events that triggered them, branded as Stout's work.
- **Decks shrink, not disappear.** Quarterly briefings become "here is what we recommend you do," not "here is what happened" -- a more senior, higher-margin artifact.

#### Why visibility usually helps, not hurts

- Clients who see continuous activity perceive more value than clients who get one polished deck per quarter.
- Quarterly cadence has a known failure mode: clients forget you exist for ten weeks, then judge the entire engagement by one artifact.
- A live, annotated environment keeps Stout present in the client's workflow every week.

#### Where the risk does bite -- and how to defuse it

- **Pricing posture.** Never expose the platform as a SaaS line item. Bundle inside the CI retainer. Invoice reads "Competitive Intelligence Program -- Q1," not "Platform license + advisory hours."
- **Sales framing.** Position the platform as Stout's instrument, not the product. "We use this to deliver intelligence to you; the strategic work is ours."
- **Honest about commoditization.** Pure news roll-ups with no strategic layer *should* compress. That frees senior capacity for higher-margin work.
- **Switching cost rises.** Watchlists, annotations, historical event log, and scenario models living in the Stout-branded environment mean leaving = losing institutional memory. Static decks have zero switching cost.

### 5b. Competitor landscape -- pricing and focus (from buyer chatter)

Source: r/biotech thread "Thoughts on pharma intel databases like Evaluate, GlobalData, etc." -- self-reported by people who actually use these tools in pharma BD, R&D, and commercial roles.

#### Pricing data points

- **Evaluate** -- "five digits" annual for a company under 500 employees ($10K--$99K total contract). One commenter notes they "negotiated quite a good deal."
- **GlobalData** -- "six digits" at the same sub-500 employer for a comparable product. Widely seen as overpriced.
- **Per seat (general)** -- "$20--$50K per seat is typical" depending on the bundle of services.
- **Company-wide enterprise access** -- one buyer estimates "hundreds of thousands... if not million-plus" for major pharma full-firm licenses.
- **Pricing transparency** -- "Pricing seems far from transparent and I can't tell if I'm getting a great deal on Evaluate or getting ripped off." Customers cannot benchmark themselves.
- **Adjacent reference points** -- STAT+ ~$300/yr, EndPoints News low thousands -- journalism, not data.

#### Focus areas

| Platform | Primary focus | Notes |
|---|---|---|
| **Evaluate** | Sales forecasts, commercial/business data, competitor insights, epi data | Most commercial-leaning of the big three |
| **Citeline** (formerly Pharma Intelligence) | R&D, clinical trials, early research | PinkSheet sub-product is "unparalleled" for regulatory milestones (approvals, amendments, CRLs) |
| **GlobalData** | Broad coverage overlapping Evaluate + Citeline | Quality issues -- "significant amount of the info seems to be inaccurate or out of date" |
| **Cortellis** | Preclinical + clinical data, dev status, patents, regulatory status | Closer to Citeline than Evaluate; some skepticism after multiple ownership changes |
| **DRG** | BD deal comps, search & evaluation, NPV, market sizing | Called out specifically for BD workflows |
| **TA Scan** | Competitive landscape analytics, site identification, strategic feasibility | Lesser-known; described as having better data quality than the big incumbents |
| **Hanson Wade** | Niche modality databases (ADC, bispecific) | Deep but narrow |
| **BioWorld** | News-leaning | Mentioned as good for ongoing coverage |

#### Pain points (verbatim or paraphrased)

- **Clunky interfaces.** "I've often found them to be a bit clunky."
- **Stale and inaccurate data.** GlobalData specifically. Generalized: "if you trust only one of them, you will miss at least 20% of updated information."
- **Forced multi-platform redundancy.** Buyers run two or more and manually cross-check.
- **Aggressive sales tactics.** GlobalData: "the most aggressive, obnoxious, don't-take-no-for-an-answer salesforce in our biz."
- **Opaque pricing.** No public benchmark, every deal is bespoke.
- **Vendor instability.** Cortellis ownership has changed multiple times.

#### What this tells us for Clint's positioning

- **Price anchor.** A $75K--$150K practice license slots cleanly *under* a six-figure GlobalData deal and at parity with a small-firm Evaluate license, but with whitelabel + AI-ready data that no incumbent offers.
- **Coverage gap is the real wedge.** Buyers admit a single platform misses ~20% of updates. Clint does not need to beat Evaluate at its own data depth on day one -- it needs to be the layer where Stout's *curated, annotated* view sits on top, with the strategic read attached.
- **UX is a genuine differentiator, not marketing fluff.** Buyers themselves describe these tools as clunky.
- **Data quality and provenance need to be honest.** Source citations on every event are the price of entry for advisory firm output.
- **Sell against opacity.** Transparent pricing tiers is itself a differentiator.

---

## 6. Open questions and next steps

In rough order of dependency:

1. **Sign founder/advisor agreement** between user and partner. Formalizes IP ownership, partner equity/advisory share, and disclosure framework. **Before any Stout MD conversation.**
2. **Confirm partner is comfortable with the disclosure script** in section 2 above. Get the wording right.
3. **Decide pilot scope and price** before the MD meeting -- so partner can answer "what would a trial look like" without making it up. Suggest fixed-fee, 60--90 days, $25K--$50K.
4. **Identify the right MD** -- name, practice focus, recent pharma CI / valuation / M&A engagements.
5. **Honest data coverage baseline** -- which sources are in, which are gaps, what the gap-fill plan is. Prepared for the walkthrough.
6. **SOC 2 / data provenance status** -- what we say today vs. what's on roadmap. Advisory firms will ask.
7. **Pricing tier sheet** -- keep three tiers from section 3 but de-emphasize until pilot is in motion. Don't lead with price.
8. **Reference client / case study** -- do we have anyone (even a friendly pilot) we can name? If not, the Stout pilot itself becomes the first case study, which is leverage on pricing.
