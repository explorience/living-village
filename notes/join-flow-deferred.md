# Join flow — deferred improvements

These are the technical/UX issues identified on 2026-05-07 that we're parking
while we redesign the application around deeper personal questions (not money).
Revisit after the redesign lands.

1. **Resume where you left off.** State persists in sessionStorage but a refresh dumps
   the user back to Threshold. Either auto-resume, or ask "Continue where you left
   off?" on return.

2. **No progress sense.** Users don't know they're on moment 3 of 7. Consider a
   subtle dot indicator OR commit fully to no-indicator (which suits the "slow"
   vibe).

3. **Stripe loads on page load.** `js.stripe.com/v3/` is pulled even if the user
   only reads Threshold. Defer until the contribution moment is reached.
   *(Will become irrelevant if money moves out of the application entirely — keep
    note in case payment lands somewhere else later.)*

4. **Sheet write blocks the welcome screen.** `await submitToSheet()` runs before
   `showMoment('welcome')` — a slow Google Sheets call delays the user's
   confirmation. Make it fire-and-forget.

5. **No imagery anywhere.** Pure typographic flow. A small evocative photo at
   Threshold and Welcome would soften the contrast with the homepage's lush
   imagery. Avoid mid-flow images (would slow things further).

6. **Mobile slider fiddly.** Could pair with three preset taps ($22 / $77 / $222).
   *(Becomes irrelevant if slider is removed.)*

7. **Focus & screen-reader handling between moments.** Moment transitions don't
   move keyboard focus or announce — keyboard/AT users get silently teleported.
   Move focus to the new heading and add `aria-live` to the moment region.

8. **Stripe-redirect return path is half-wired.** If Stripe redirects back with
   `payment_intent`, flow shows Welcome but doesn't run `submitToSheet`, so the
   sheet row never lands. Detect the redirect param and trigger the sheet write.
   *(Becomes irrelevant if Stripe is removed.)*
