# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static landing page for **The Living Village** (two-day gathering, Aug 15–16 2026). The entire page lives in `index.html` (~520 lines, inline CSS + JS, no framework, no build step). Two Vercel serverless functions live under `api/`.

## Commands

No build, no tests, no linter. Development is direct editing + `vercel dev`.

- `vercel dev` — run static site + serverless API locally (requires Vercel CLI and project linked via the `.vercel/` directory).
- `vercel --prod` — deploy to production. Pushes to the linked Vercel project also auto-deploy.
- Edit `index.html` directly; open in a browser for pure-static changes that don't touch `/api`.

Node >= 18. `package.json` sets `"type": "module"`, so `api/*.js` files use ESM (`export default`).

## Architecture

**`index.html`** — single-file site. All styling is in one `<style>` block; the only JS is the signup form handler at the bottom (`POST /api/signup` with `{ email, name, roles[], comment, timestamp }`).

**`api/signup.js`** — receives the form POST, refreshes a Google OAuth access token, then appends a row to a Google Sheet via the Sheets v4 REST API.
- Sheet ID is hardcoded: `16TL2Bqa4gl8H5R8nQe0JvhQa2IwajeuzLvlcka8l3dI`, tab `Signups`, range `A:E`.
- The append URL must URL-encode `!` as `%21` and `:` as `%3A` (`Signups%21A%3AE:append`). An earlier bug fix corrected this — don't regress it.
- **Fail-loud:** the handler returns `502` when token refresh or Sheet write fails, and `500` on unexpected errors. The client form shows an error message so missing env vars or an expired refresh token surface immediately instead of silently dropping signups.

**`api/debug.js`** — reports which of the three Google env vars are present. Useful for diagnosing missing Vercel env config; safe to leave in place since it only exposes presence booleans and a 15-char prefix of the client ID.

**Required env vars** (set in Vercel project settings): `GCLIENT_ID`, `GCLIENT_SECRET`, `GREFRESH_TOKEN`. These are a Google OAuth2 app + refresh token with Sheets scope on the target spreadsheet.

**`vercel.json`** — minimal routing: `/api/*` → serverless functions, everything else → static files. No rewrites beyond that.

**`event.ics`** — static calendar file served from root for the "add to calendar" flow.

## Notes for changes

- The signup form in `index.html` and the `signup.js` handler share an implicit schema (`email`, `name`, `roles`, `comment`, `timestamp` → columns A–E). Keep them in sync when adding fields, and extend the sheet range past `E` if adding a column.
- Hero/role images in `images/` are large (1–5 MB). Be mindful when adding more — there's no image pipeline.
