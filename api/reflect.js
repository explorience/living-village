// Post-gathering reflections: POST to save (public), GET to list (crew session only).
//
// Saving is UNAUTHENTICATED for the same reason the waiver is: the link goes out in a plain
// email and a magic-link round trip would cost us responses. The row id is minted by the
// browser and kept in its localStorage, which is what lets someone finish the form later on
// the same device.
//
// Every keystroke pause writes, not just the submit button. Someone who answers three
// questions and abandons the page has still told us something true, and that partial row is
// often more honest than a completed one.

import { getSession } from './_lib/auth.js';
import { saveReflection, getAllReflections } from './_lib/db.js';

const MAX = { id: 64, name: 200, email: 320, answers: 60000 };
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    try {
      const reflections = await getAllReflections();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        count: reflections.length,
        completed: reflections.filter(r => r.completed).length,
        reflections,
      });
    } catch (err) {
      console.error('reflection list failed:', err.message);
      return res.status(502).json({ error: 'read_failed', detail: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const b = req.body || {};

  // Honeypot: a real person never sees this field, so anything in it is a bot.
  // Answer 200 so the bot has no signal that it was caught.
  if (typeof b.website === 'string' && b.website.trim() !== '') {
    return res.status(200).json({ ok: true });
  }

  const id = clip(b.id, MAX.id);
  if (!/^rf_[a-z0-9_]{8,}$/.test(id)) return res.status(400).json({ error: 'bad_id' });

  const answers = (b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers)) ? b.answers : {};
  // One oversized paste must not be able to fill the column, and a partial save is worth
  // more than a rejected one, so refuse the payload rather than silently truncating JSON.
  if (JSON.stringify(answers).length > MAX.answers) {
    return res.status(413).json({ error: 'answers_too_large' });
  }

  try {
    const saved = await saveReflection({
      id,
      name: clip(b.name, MAX.name),
      email: clip(b.email, MAX.email),
      answers,
      completed: b.completed === true,
      userAgent: clip(req.headers['user-agent'], 400),
    });
    return res.status(200).json({ ok: true, id: saved.id, savedAt: saved.updated_at });
  } catch (err) {
    console.error('reflection save failed:', err.message);
    return res.status(502).json({ error: 'save_failed', detail: err.message });
  }
}
