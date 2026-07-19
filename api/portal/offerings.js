// POST /api/portal/offerings { offerings: string[], gifts: string }
// Appends the roles/offerings an attendee adds (add-only) and saves their free-text gifts.
// Writes to the portal_* columns so a sheet sync never clobbers them. Session-scoped: a
// person can only edit their own record.

import { readSessionEmail } from '../_lib/auth.js';
import { ensureSchema, addPortalOfferings } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const email = readSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'unauthorized' });

  const body = req.body || {};
  const offerings = Array.isArray(body.offerings)
    ? body.offerings.map(s => String(s).slice(0, 120)).filter(Boolean).slice(0, 40)
    : [];
  const gifts = typeof body.gifts === 'string' ? body.gifts.slice(0, 2000) : '';

  try {
    await ensureSchema();
    const result = await addPortalOfferings(email, { offerings, gifts });
    if (!result) return res.status(404).json({ error: 'no_signup' });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('portal/offerings failed:', err.message);
    return res.status(502).json({ error: 'save_failed' });
  }
}
