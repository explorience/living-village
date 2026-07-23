// POST { email } -> emails a magic login link if the address is on the allowlist.
// Always responds 200 so the page can't be used to probe who's allowed.

import { isAllowed, makeLoginToken, makeAttendeeToken } from '../_lib/auth.js';
import { ensureSchema, isSignup } from '../_lib/db.js';

// The admin lives at livingvillage.ca and the sign-in email is sent FROM livingvillage.ca,
// so the sender domain matches the link domain. That alignment, plus plain transactional
// content that shows the real URL, is what stops Gmail quarantining the login email as
// cross-domain phishing (it was eating the old heenai.xyz -> livingvillage.ca version).
const BASE_URL = process.env.PUBLIC_BASE_URL || 'https://www.livingvillage.ca';
const MAGIC_FROM = process.env.MAGIC_LINK_FROM || 'The Living Village <hello@livingvillage.ca>';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const ok = { ok: true, message: 'If that address is on the list, a sign-in link is on its way.' };

  // Crew get a short-lived link; anyone who signed up gets a long-lived attendee link.
  // Everyone else gets a silent 200 (never reveal who's on the list).
  let token = null;
  if (isAllowed(email)) {
    token = makeLoginToken(email);
  } else if (email) {
    try { await ensureSchema(); if (await isSignup(email)) token = makeAttendeeToken(email); }
    catch (err) { console.error('signup lookup failed:', err.message); }
  }
  if (!token) return res.status(200).json(ok);

  try {
    const link = `${BASE_URL}/api/auth/callback?token=${encodeURIComponent(token)}`;
    await sendLink(email, link);
  } catch (err) {
    console.error('magic-link send failed:', err.message);
    // Still 200 to the client; the error is logged for us.
  }
  return res.status(200).json(ok);
}

async function sendLink(email, link) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');

  const text = [
    'Sign in to the Living Village admin.',
    '',
    'Use this link (it works for 20 minutes):',
    link,
    '',
    "If you didn't request this, you can ignore this email.",
    '',
    'The Living Village',
  ].join('\n');

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#2c2a26;line-height:1.6;font-size:16px;">
  <p>Hi,</p>
  <p>Here is your sign-in link for the <strong>Living Village admin</strong>. It works for 20 minutes.</p>
  <p style="margin:24px 0;">
    <a href="${link}" style="display:inline-block;background:#3f6b52;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:15px;">Sign in</a>
  </p>
  <p style="color:#6b6760;font-size:14px;margin-bottom:4px;">Or paste this link into your browser:</p>
  <p style="font-size:13px;word-break:break-all;"><a href="${link}" style="color:#3f6b52;">${link}</a></p>
  <p style="color:#6b6760;font-size:14px;margin-top:24px;">If you didn't request this, you can ignore this email.</p>
  <p style="color:#6b6760;font-size:14px;">The Living Village</p>
</div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAGIC_FROM, to: [email], subject: 'Sign in to the Living Village admin', text, html }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 160)}`);
}
