Review a feature from the Stout MD/partner perspective: $ARGUMENTS

You are simulating the evaluation of a Clint feature by a Managing Director at Stout Strategy, Health Care Practice. This person runs pharma CI engagements, evaluates tools for competitive intelligence delivery, and is deciding whether Clint differentiates Stout's offering.

---

## Phase 1: Load persona context

1. Read `docs/notes/stout-positioning.md` in full. This is the source of truth for:
   - What the MD cares about (stickiness, differentiation, live data, AI-ready shape)
   - The product positioning (what Clint claims to be)
   - The MD's likely objections (section 5a: "won't clients see how the pudding is made?")
   - Competitor context (Evaluate, Citeline, GlobalData pricing and pain points)
   - The engagement structure the partner is pitching (free pilot, co-creator partnership)

2. Extract the MD's core evaluation questions:
   - Does this create stickiness with my clients?
   - Does this differentiate us from other advisory firms?
   - Where does my team's judgment layer in (annotations, curation, strategic read)?
   - Is this live/event-driven or static?
   - Can I imagine putting this in front of a pharma VP?
   - How does this replace or augment the quarterly deck?
   - Does the UX feel premium enough for the buyer persona?

---

## Phase 2: Analyze the feature

1. Resolve `$ARGUMENTS` as a file path. If it is an HTML prototype, read it and understand the UI, interactions, and data model. If it is a component path, read the component + template + any service it depends on. If it is a spec, read the spec.

2. Identify what the feature does, how it presents data, what controls/interactions exist, and what the user journey looks like.

3. Map the feature's capabilities against the MD's evaluation questions from Phase 1.

---

## Phase 3: Simulated walkthrough

Write a first-person narrative as the Stout MD experiencing this feature for the first time during a 30-minute demo. Use their voice: skeptical, commercially minded, pattern-matching to incumbents (Evaluate, Citeline), looking for the "so what?" that justifies bringing this to their clients.

Structure:
- **First 10 seconds:** What do I see? What's my gut reaction? Does it feel premium or generic?
- **First question I ask:** What is the most natural question this surface prompts?
- **Trying to answer my own question:** Can I find the answer without help? How long does it take?
- **The competitive comparison:** How does this compare to what I already use?
- **The client imagination test:** Can I picture showing this to [pharma VP / BD head / portfolio lead]?
- **Where's my team's value?:** Where does Stout's judgment appear? Is it prominent or buried?
- **The "live data" test:** Does this feel current/dynamic, or could it be a static export?
- **Unanswered questions:** What am I left wondering that would block me from saying "yes, let's pilot this"?

Keep it honest. If the feature is strong in an area, say so briefly. Spend more words on gaps and friction.

---

## Phase 4: Gap analysis

Structured table format:

| # | MD question | Feature answers it? | Evidence | Gap / friction | Suggested fix |
|---|---|---|---|---|---|

For each row:
- **MD question:** One of the evaluation questions from Phase 1
- **Feature answers it?:** Yes / Partially / No
- **Evidence:** What specifically in the feature addresses (or fails to address) the question
- **Gap / friction:** What's missing or unclear
- **Suggested fix:** Concrete, actionable change (not vague "improve X")

---

## Phase 5: Priority actions

List the top 3-5 changes that would most move the needle for this persona, ordered by impact. For each:
- What to change
- Why it matters to this specific persona (link back to positioning doc)
- Rough effort (small / medium / large)

---

## Output format

Print all phases sequentially. Use markdown headers. Keep the walkthrough to ~400 words max. Keep the gap analysis table tight. End with the priority actions list.

Do not suggest changes that contradict the brand guide in `docs/brand.md` or the design principles in `CLAUDE.md`.
