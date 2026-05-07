# Join flow — redesign (v2)

Drafted 2026-05-07 with Heenal. Locks the structure; copy stays editable.

## What's changing

**Out:**
- Reciprocity Pool slider ($22–$222) and the "Pool" moment that explained it
- Stripe payment as the last gesture
- Money as a gating concept in the application

**In:**
- A "What's pulling you here?" open prompt (one of two soft-required deep questions)
- A "Where you are on the path" card-pick (achievability framing — every option implies progress is possible)
- A topic-interest bucketing exercise with inline co-creator opt-in per topic
- A lite Community Spectrums moment — 8 curated spectrums from Ma'ikwe Ludwig's *Together Resilient*
- A brave-honesty prompt: "Anything we should know about how you show up in groups?"
- The big question — *"What would have to be true for you to live in a village like this?"* — placed on the welcome moment as the start of the conversation, not a gate
- A June 20 solstice work-bee + dance + overnight camping invitation on the welcome moment
- A homepage callout for the same solstice event (separate, parallel work)

**Money becomes:** one quiet line in "What you might bring" ("Some people contribute financially to the Reciprocity Pool — we'll share more on that closer to the event") and an optional line in welcome.

## The 8 moments

1. **Threshold** — same intro shape, lightly rewritten without the money emphasis. "There's no ticket here. Just a slower way of saying yes."
2. **What's pulling you here?** — open prompt, 4-line textarea, 3–4 example answers shown ghosted/below. Soft min, easy skip.
3. **Where you are on the path** — single-select cards (curious / following the thread / scouting / planning / on land / already living it) + optional follow-up textarea.
4. **What's calling you** — 14-topic bucket-sort (Yes / Curious / Skip), inline "+ I could share or lead this" opt-in per topic, plus a free-form "Anything else?" field.
5. **Spectrums** — 8 sliders, each with X-position + tolerance range (or position + rigidity toggle if dual-handle is too fiddly on mobile). Source: Ma'ikwe Ludwig's *Together Resilient*. Frame: "Knowing your range so you find your people."
6. **What you might bring** — existing roles section (slightly tightened) + micro-offerings + free-form offer + the quiet line about financial contribution.
7. **Vow + Practical** — combined. Three vow lines, sign with first name, that signature *is* the name. Then email, last name, dietary, accessibility, and the brave prompt at the bottom.
8. **Welcome** — "You're in." Then the big question as optional reflection, the June 20 solstice invite, an .ics download, and the financial-contribution line.

## Topic list (14, names workshoppable)

1. Ecovillage governance & community agreements
2. Natural building (cob, straw bale, healthy materials)
3. Permaculture design for community land
4. Zoning, land use & legal pathways
5. Cooperative finance — how a village is paid for
6. Indigenous-led land trusts & decolonizing land
7. Conflict, repair & cooperation
8. Authentic Relating
9. Multigenerational community
10. Cultural integration & bridging difference
11. Land stewardship & forest walks
12. Circles, storytelling & ritual
13. Music, dance & fire
14. Stories from existing ecovillages — what works, what didn't

Note: Community Spectrums is *not* a topic — we're doing the exercise live at the event, and there's a lite version embedded earlier in this flow.

## Spectrums (8, lite version of Ma'ikwe Ludwig's tool)

| # | Spectrum | Left anchor | Mid (where applicable) | Right anchor |
|---|---|---|---|---|
| 1 | Diet | Vegan | Vegetarian / Omnivore | Paleo / Ancestral |
| 2 | Residential style | Shared living | Clustered homes | Individual homes |
| 3 | Decision-making | Deep alignment | Consensus / Voting | Sole leader |
| 4 | Community engagement hours | Minimal | — | Maximal |
| 5 | Children in community | Children are central | Welcomed, not the focus | No children |
| 6 | Pets | Pets everywhere | Managed levels | No pets |
| 7 | Tech & life pace | Low-tech / agrarian | — | High-tech / eco-modernist |
| 8 | Activism vs. example | Active in the broader world | — | Live the alternative quietly |

UX: each spectrum gets a slider for preferred position + a small affordance for tolerance range or rigidity (whichever lands better in mobile testing). State persists in sessionStorage.

## Co-creator opt-in (per topic)

Inline expansion. After bucketing a topic Yes or Curious, a `+ I could share or lead this →` link appears under the row. Tapping opens a small textarea: *"What you'd bring to this — a story, a session, an hour of teaching, an opinion. Optional."*

For topics bucketed Skip, no affordance.

## Brave-honesty prompt

Sits at the bottom of moment 7 (Vow + Practical), labelled gently:

> **Anything we should know about how you show up in groups?**
> *Optional. Patterns you're working on, things that help you, things you'd want us to know. We'll hold whatever you share carefully.*

## The big question (welcome moment)

After the "You're in" confirmation, framed as a reflection, not a survey:

> **One last thing — for the conversation we want to keep having.**
> What would have to be true for you to live in a village like this?
> *Optional. Take your time. We read every one.*

## June 20 solstice invitation (welcome moment)

> **Before the village, there's a smaller invitation.**
> Saturday June 20 — a work-bee day at The Living Centre in London. We'll be on the land, building, planting, getting things ready. Around the fire that evening, we'll join The Living Centre's solstice dance. Camp overnight if you want.
> [ Let us know you're coming → ] *(checkbox or RSVP link)*

## Sheet schema changes (api/signup.js)

Range widens from `A:K` to roughly `A:V` (need to confirm exact width before write).

| Col | Field |
|---|---|
| A | timestamp |
| B | email |
| C | name |
| D | roles (existing) |
| E | comment / free-form offer |
| F | (was: amount — now empty / future financial contribution) |
| G | micro-offerings |
| H | vow (signature) |
| I | dietary |
| J | accessibility |
| K | paymentIntentId (kept; will be empty until financial contribution is wired separately) |
| L | why_pulled_you |
| M | path_position |
| N | path_note |
| O | topics_yes |
| P | topics_curious |
| Q | topics_skip |
| R | topic_co_creator (formatted: "Topic — note; Topic — note") |
| S | topic_other |
| T | spectrums (JSON: per spectrum, position + tolerance/rigidity) |
| U | brave_prompt |
| V | big_question |
| W | solstice_rsvp (boolean) |

Backwards-compatible: older homepage signups still send the original fields and skip the new ones.

## Technical plan

1. Widen sheet range and field schema in `api/signup.js`. Keep accepting old shape.
2. Rewrite `join/index.html` flow:
   - Remove Stripe `<script>` and the Pool, Shape (slider), and Contribution moments
   - Add Why, Where, Topics, Spectrums moments
   - Refactor "What you might bring" (former Shape minus money) and Vow + Practical (merged)
   - Update Welcome moment with big question + solstice invite
   - Migrate state schema to v2 (`lv-join-v2`)
3. Solstice callout on the homepage `index.html` — small section near the signup, plus or instead of the "Begin the journey" CTA mention.
4. Address the deferred items in `notes/join-flow-deferred.md` opportunistically (focus management on moment change, fire-and-forget sheet write, deferred Stripe loading is moot now that Stripe is gone).

## What's still editable

- Topic names — workshop together as we test
- Spectrum anchor labels — minor tweaks
- All copy — drafted as I build, expect to iterate
