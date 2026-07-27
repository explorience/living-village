// GET  /api/admin/emails            -> every editable template (current copy + defaults + tokens)
// POST /api/admin/emails {key,...}   -> save the copy for one template
// POST /api/admin/emails {test:true} -> send the CURRENT DRAFT to the crew member, without saving,
//                                       so they can eyeball the real thing before it goes live.
// Crew-only (same session gate as the rest of /api/admin/*).

import { getSession, makeLoginToken, baseUrl } from '../_lib/auth.js';
import { ensureSchema } from '../_lib/db.js';
import { TEMPLATES, listTemplatesForAdmin, saveTemplate, renderFromValues, fromAddrFor } from '../_lib/emails.js';

// Stand-in token values for the preview send, so {firstName}/{link}/{expiry} show something real.
function sampleTokens(key, req, email) {
  if (key === 'signin_link') {
    const link = `${baseUrl(req)}/api/auth/callback?token=${encodeURIComponent(makeLoginToken(email))}`;
    return { link, expiry: '20 minutes' };
  }
  return { firstName: 'there' };
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const templates = await listTemplatesForAdmin();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ me: session.email, templates });
    }

    if (req.method === 'POST') {
      const { key, subject = '', body = '', replyTo = '', test = false } = req.body || {};
      if (!TEMPLATES[key]) return res.status(400).json({ error: 'unknown_template' });
      const subj = String(subject).trim();
      const bod = String(body);
      if (!subj) return res.status(400).json({ error: 'subject_required' });
      if (!bod.trim()) return res.status(400).json({ error: 'body_required' });

      if (test) {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) return res.status(502).json({ error: 'email_not_configured' });
        const tokens = sampleTokens(key, req, session.email);
        const { subject: s, text, html, replyTo: rt } = renderFromValues(key, { subject: subj, body: bod, replyTo }, tokens);
        const payload = { from: fromAddrFor(key), to: [session.email], subject: `[TEST] ${s}`, text, html };
        if (rt) payload.reply_to = rt;
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) return res.status(502).json({ error: 'send_failed', detail: (await r.text()).slice(0, 160) });
        return res.status(200).json({ ok: true, test: true, to: session.email });
      }

      const saved = await saveTemplate(key, { subject: subj, body: bod, replyTo }, session.email);
      return res.status(200).json({ ok: true, saved });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('admin/emails failed:', err.message);
    return res.status(502).json({ error: 'failed', detail: err.message });
  }
}
