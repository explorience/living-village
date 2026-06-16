// POST { email } -> emails a magic login link if the address is on the allowlist.
// Always responds 200 so the page can't be used to probe who's allowed.

import { isAllowed, makeLoginToken, baseUrl } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const ok = { ok: true, message: 'If that address is a keeper, a link is on its way.' };

  if (!isAllowed(email)) return res.status(200).json(ok);

  try {
    const token = makeLoginToken(email);
    const link = `${baseUrl(req)}/api/auth/callback?token=${encodeURIComponent(token)}`;
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
  const from = process.env.RESEND_FROM || 'The Living Village <onboarding@resend.dev>';

  const text = [
    'Here is your link into the Living Village keepers’ room.',
    '',
    link,
    '',
    'It opens for 20 minutes, then quietly closes. If you didn’t ask for this, you can ignore it.',
    '',
    'The Living Village',
  ].join('\n');

  const html = `<div style="font-family:Georgia,'Times New Roman',serif;max-width:480px;margin:0 auto;color:#2A1D10;line-height:1.6;font-size:16px;">
  <p style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#9A8A73;margin-bottom:18px;">The Living Village</p>
  <p>Here is your link into the keepers’ room.</p>
  <p style="margin:26px 0;">
    <a href="${link}" style="display:inline-block;background:#C4704B;color:#F6EDD9;text-decoration:none;padding:13px 26px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:15px;">Open the gate</a>
  </p>
  <p style="color:#9A8A73;font-size:14px;">It opens for 20 minutes, then quietly closes. If you didn’t ask for this, you can ignore it.</p>
</div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject: 'Your link into the Living Village', text, html }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 160)}`);
}
