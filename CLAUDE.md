# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static site for **The Living Village** (two-day gathering, Aug 15–16 2026), no framework / no build step. `index.html` is the landing page. Vercel serverless functions live under `api/`.

**The gathering has happened.** Registration is closed: the landing page now states that plainly and ends in a two-field "stay in touch" form, and `join/index.html` is served behind a notice band with the whole flow `inert` (see Architecture). Nothing on the site takes a registration any more.

## Commands

No build, no tests, no linter. Development is direct editing + `vercel dev`.

- `vercel dev` — run static site + serverless API locally (requires Vercel CLI and project linked via the `.vercel/` directory).
- `vercel --prod` — deploy to production. Pushes to the linked Vercel project also auto-deploy.
- Edit `index.html` directly; open in a browser for pure-static changes that don't touch `/api`.

Node >= 18. `package.json` sets `"type": "module"`, so `api/*.js` files use ESM (`export default`).

## Architecture

**`index.html`** — landing page, single file (inline CSS + JS). Post-gathering it carries a "this gathering has happened" pill in the hero and one CTA, `Stay in touch`, pointing at the `#stay` section at the foot of the page. That section is the **interest form**: name + email + honeypot, POSTing `{name, email, stage: 'interest'}` to `/api/signup`. On success the form element is removed and replaced by a thank-you. `#signup` is kept as an empty anchor above the section so older links still land. The June solstice work-bee section and the `event.ics` download were removed with the event.

**`join/index.html`** — the registration flow, now **closed**. A `.past-band` notice sits above `<main class="page is-closed" inert>`: `inert` stops all interaction in current browsers, `pointer-events:none` covers the rest, and the flow is dimmed to 0.6. It is left in place as a record of what people were asked, so nothing below the band should be deleted. What it was: a multi-moment progressive form (Threshold → Orientation → Why → Path → Topics → Bring → Practical → Welcome). POSTs to `/api/signup` with the full payload and a `stage`: `final`, `partial:why`, `partial:bring`, or unset for the post-Welcome "big question" follow-up. Partial saves fire mid-flow so abandoned signups are still captured.

**`api/signup.js`** — receives the POST and, in parallel:
1. **Appends a row to the Google Sheet** (Sheets v4 REST, OAuth refresh-token). Sheet `16TL2Bqa4gl8H5R8nQe0JvhQa2IwajeuzLvlcka8l3dI`, tab `Signups`, **25-column schema `A:Y`** (timestamp, email, name, roles, comment, amount, micro, vow, dietary, accessibility, paymentIntentId, why, pathPosition, pathNote, topicsYes/Curious/Skip, topicCoCreator, topicOther, spectrums, bravePrompt, bigQuestion, solsticeRsvp, orientation, stage).
   - **Append target is `Signups!A1` + `insertDataOption=INSERT_ROWS`** (encoded `Signups%21A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`; `%21`=`!`). **Do NOT revert to a wide range like `A:Y`** — Sheets' table auto-detection drifts on sparse rows and starts writing at column Y. Fixed 2026-06-04 (and the legacy column-Y rows were shifted back to A:Y).
2. **Backup email via Resend** (`sendBackupEmail`) — human summary + raw JSON — to `RESEND_TO` from `RESEND_FROM`.
3. **Applicant confirmation via Resend** (`sendApplicantConfirmation`) — warm "your yes is received" email — sent **only when `stage === 'final'`** (so partials and the follow-up don't trigger it); reply-to = `RESEND_TO`. Its failure never blocks the signup.
- **Success = Sheets OR backup-email worked** → `200`; only if *both* fail → `502`. The applicant confirmation doesn't affect success.

**`api/debug.js`** — reports presence of the three Google env vars (booleans + 15-char client-id prefix). Note: it does **not** check the Resend vars.

**`api/checkout.js`** — legacy Stripe PaymentIntent endpoint, **unused** (payment was removed from the join flow). Safe to ignore.

**Required env vars** (Vercel project settings):
- Google Sheets: `GCLIENT_ID`, `GCLIENT_SECRET`, `GREFRESH_TOKEN` (OAuth2 app + refresh token with Sheets scope on the target sheet).
- Email (Resend): `RESEND_API_KEY` (the 1heenal key, where `heenai.xyz` is verified), `RESEND_FROM` (e.g. `The Living Village <living-village@heenai.xyz>` — **must be a Resend-verified domain or mail is accepted but never delivered**), `RESEND_TO` (team inbox, currently `hello@journeyland.ca`).

**`vercel.json`** — minimal routing: `/api/*` → serverless functions, everything else → static files. **`event.ics`** — static calendar file for the "add to calendar" flow.

## Notes for changes

- **Post-gathering interest signups reuse this same endpoint**, tagged `stage: 'interest'` in column Y. They are deliberately not partials (so they are kept) and not `final` (so no applicant confirmation goes out); the crew still gets the backup email, subject-tagged `interest`. `mergeGroup()` in `_lib/sheet.js` turns the tag into an `interestOnly` boolean — **`every` row, not `some`**, so an attendee who also fills the form in stays an attendee. Backstage surfaces it as the `◇ interest` counts-bar chip, a pill on the person's card, a drawer badge and a CSV column.
- The `join/index.html` payload and `signup.js`'s `rowData` array share an implicit **25-column schema (A–Y)**. Keep them in sync when adding fields, and update the sheet header row + the 25-length `rowData` together. Keep the append anchor at `A1` + `INSERT_ROWS` (see Architecture).
- Hero/role images in `images/` are large (1–5 MB). Be mindful when adding more — there's no image pipeline.
