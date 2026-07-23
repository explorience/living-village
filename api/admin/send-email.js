// POST /api/admin/send-email  { ids:[], subject, body, replyTo, test:bool }
// Crew-only. Sends a personalized email to each selected signup with their OWN one-tap
// magic link to the Portal appended. test:true sends a single copy to the crew member
// instead, so they can eyeball the real thing before blasting the list.
//
// From: a Resend-verified domain (hello@livingvillage.ca) so it actually delivers.
// Reply-To: whatever the sender sets (defaults to Savannah in the UI) — replies land in
// that normal inbox; we do NOT ingest replies into the app.

import { getSession, makeAttendeeToken } from '../_lib/auth.js';
import { ensureSchema, getAllApplicants } from '../_lib/db.js';

const BASE_URL = process.env.PUBLIC_BASE_URL || 'https://www.livingvillage.ca';
const MAGIC_FROM = process.env.MAGIC_LINK_FROM || 'The Living Village <hello@livingvillage.ca>';
const MAX_RECIPIENTS = 300;
const CHUNK = 4; // gentle on a young sending domain / Resend rate limits

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const validEmail = e => /.+@.+\..+/.test(e || '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(502).json({ error: 'email_not_configured' });

  const { ids = [], subject = '', body = '', replyTo = '', test = false } = req.body || {};
  const subj = String(subject).trim();
  const bodyText = String(body);
  if (!subj) return res.status(400).json({ error: 'subject_required' });
  if (!bodyText.trim()) return res.status(400).json({ error: 'body_required' });

  try {
    await ensureSchema();
    const all = await getAllApplicants();

    let recipients;
    if (test) {
      recipients = [{ email: session.email, name: 'you (test)' }];
    } else {
      const idset = new Set(ids);
      recipients = all
        .filter(a => idset.has(a.id) && validEmail(a.email))
        .map(a => ({ email: a.email, name: a.name || '' }));
    }
    if (!recipients.length) return res.status(400).json({ error: 'no_recipients' });
    if (recipients.length > MAX_RECIPIENTS) return res.status(400).json({ error: 'too_many', max: MAX_RECIPIENTS });

    let sent = 0; const failed = [];
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const batch = recipients.slice(i, i + CHUNK);
      const results = await Promise.allSettled(batch.map(r => {
        const token = makeAttendeeToken(r.email);
        const link = `${BASE_URL}/api/auth/callback?token=${encodeURIComponent(token)}`;
        return sendOne(apiKey, r.email, subj, bodyText, link, replyTo);
      }));
      results.forEach((r, idx) => { if (r.status === 'fulfilled') sent++; else failed.push(batch[idx].email); });
    }
    return res.status(200).json({ ok: true, sent, failed, total: recipients.length, test: !!test });
  } catch (err) {
    console.error('send-email failed:', err.message);
    return res.status(502).json({ error: 'send_failed', detail: err.message });
  }
}

async function sendOne(apiKey, email, subject, bodyText, link, replyTo) {
  const safeBody = esc(bodyText).replace(/\n/g, '<br>');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#2c2a26;line-height:1.6;font-size:16px;">
  <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#7a9e7e;margin-bottom:16px;">The Living Village</div>
  <div>${safeBody}</div>
  <p style="margin:28px 0;">
    <a href="${link}" style="display:inline-block;background:#3f6b52;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:15px;">Enter your village space</a>
  </p>
  <p style="color:#6b6760;font-size:13px;word-break:break-all;">Or paste this link into your browser:<br><a href="${link}" style="color:#3f6b52;">${link}</a></p>
  <p style="color:#6b6760;font-size:13px;margin-top:24px;">The Living Village</p>
</div>`;
  const text = `${bodyText}\n\nEnter your village space:\n${link}\n\nThe Living Village`;
  const payload = { from: MAGIC_FROM, to: [email], subject, text, html };
  if (validEmail(replyTo)) payload.reply_to = replyTo;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 140)}`);
}
