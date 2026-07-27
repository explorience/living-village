// POST { email } -> emails a magic login link if the address is on the allowlist.
// Always responds 200 so the page can't be used to probe who's allowed.

import { isAllowed, makeLoginToken, makeAttendeeToken } from '../_lib/auth.js';
import { ensureSchema, isSignup } from '../_lib/db.js';
import { renderTemplate, fromAddrFor } from '../_lib/emails.js';

// The admin lives at livingvillage.ca and the sign-in email is sent FROM livingvillage.ca,
// so the sender domain matches the link domain. That alignment, plus plain transactional
// content that shows the real URL, is what stops Gmail quarantining the login email as
// cross-domain phishing (it was eating the old heenai.xyz -> livingvillage.ca version).
const BASE_URL = process.env.PUBLIC_BASE_URL || 'https://www.livingvillage.ca';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const ok = { ok: true, message: 'If that address is on the list, a sign-in link is on its way.' };

  // Crew get a short-lived link; anyone who signed up gets a long-lived attendee link.
  // Everyone else gets a silent 200 (never reveal who's on the list). `expiry` is the
  // human wording that fills the {expiry} token so the copy matches the real link life.
  let token = null, expiry = '';
  if (isAllowed(email)) {
    token = makeLoginToken(email);
    expiry = '20 minutes';
  } else if (email) {
    try { await ensureSchema(); if (await isSignup(email)) { token = makeAttendeeToken(email); expiry = '6 weeks'; } }
    catch (err) { console.error('signup lookup failed:', err.message); }
  }
  if (!token) return res.status(200).json(ok);

  try {
    const link = `${BASE_URL}/api/auth/callback?token=${encodeURIComponent(token)}`;
    await sendLink(email, link, expiry);
  } catch (err) {
    console.error('magic-link send failed:', err.message);
    // Still 200 to the client; the error is logged for us.
  }
  return res.status(200).json(ok);
}

async function sendLink(email, link, expiry) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');

  // Copy is crew-editable (see _lib/emails.js). The sign-in email must stay FROM
  // livingvillage.ca (matching the link domain) or Gmail quarantines it — so the from
  // address deliberately stays in env, not in the editable template.
  const { subject, text, html, replyTo } = await renderTemplate('signin_link', { link, expiry });
  const payload = { from: fromAddrFor('signin_link'), to: [email], subject, text, html };
  if (replyTo) payload.reply_to = replyTo;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 160)}`);
}
