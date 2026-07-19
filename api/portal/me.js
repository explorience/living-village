// GET /api/portal/me -> the signed-in person's identity + what they're bringing.
// Accepts any valid session (crew or attendee); 401 if not signed in.

import { readSessionEmail } from '../_lib/auth.js';
import { ensureSchema, getApplicantByEmail } from '../_lib/db.js';

export default async function handler(req, res) {
  const email = readSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'unauthorized' });

  res.setHeader('Cache-Control', 'no-store');
  try {
    await ensureSchema();
    const a = await getApplicantByEmail(email);
    if (!a) {
      // Valid session but no signup row (e.g. a crew member who never applied).
      return res.status(200).json({ email, name: '', signedUp: false, roles: [], micro: [], portalOfferings: [], portalGifts: '' });
    }
    return res.status(200).json({
      email,
      name: a.name || '',
      signedUp: true,
      roles: Array.isArray(a.roles) ? a.roles : [],
      micro: Array.isArray(a.micro) ? a.micro : [],
      portalOfferings: a.portalOfferings || [],
      portalGifts: a.portalGifts || '',
    });
  } catch (err) {
    console.error('portal/me failed:', err.message);
    return res.status(502).json({ error: 'read_failed' });
  }
}
