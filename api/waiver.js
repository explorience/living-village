// Participant waiver: POST to sign (public), GET to list (crew session only).
//
// Signing is deliberately UNAUTHENTICATED. People sign at the gate on arrival by scanning a
// QR code, often on a weak rural signal, and many of them (walk-ins, plus-ones, crew, land
// hosts) were never in the applicants roster. A magic-link round trip at the gate would jam
// check-in, so there is no sign-in step here.
//
// Each signature stores the exact text that was on screen, so editing the copy later can
// never retroactively change what somebody agreed to.

import { getSession } from './_lib/auth.js';
import { saveWaiver, getAllWaivers } from './_lib/db.js';

const MAX = { name: 200, email: 320, phone: 60, address: 400, medical: 2000, text: 30000, minor: 200 };
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    try {
      const waivers = await getAllWaivers();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ count: waivers.length, waivers });
    } catch (err) {
      console.error('waiver list failed:', err.message);
      return res.status(502).json({ error: 'read_failed', detail: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const b = req.body || {};
  const name = clip(b.name, MAX.name);
  const signature = clip(b.signature, MAX.name);
  const email = clip(b.email, MAX.email);

  if (!name) return res.status(400).json({ error: 'name_required' });
  if (!signature) return res.status(400).json({ error: 'signature_required' });
  if (!b.agreed) return res.status(400).json({ error: 'agreement_required' });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'email_required' });
  }
  // The form offers consent and refusal as two separate boxes, so an unanswered
  // photography question is not the same as consent and must not be stored as one.
  if (typeof b.photoConsent !== 'boolean') {
    return res.status(400).json({ error: 'photo_choice_required' });
  }

  // The signature is a typed name; it has to actually match the person signing.
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
  if (norm(signature) !== norm(name)) return res.status(400).json({ error: 'signature_mismatch' });

  const minors = Array.isArray(b.minors)
    ? b.minors.map(m => clip(m, MAX.minor)).filter(Boolean).slice(0, 12)
    : [];

  try {
    const saved = await saveWaiver({
      id: `wv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      name,
      email,
      phone: clip(b.phone, MAX.phone),
      address: clip(b.address, MAX.address),
      emergencyName: clip(b.emergencyName, MAX.name),
      emergencyPhone: clip(b.emergencyPhone, MAX.phone),
      medical: clip(b.medical, MAX.medical),
      minors,
      photoConsent: b.photoConsent,
      signature,
      waiverVersion: clip(b.waiverVersion, 40) || 'unknown',
      waiverText: clip(b.waiverText, MAX.text),
      userAgent: clip(req.headers['user-agent'], 400),
    });
    return res.status(200).json({ ok: true, id: saved.id, signedAt: saved.signed_at });
  } catch (err) {
    console.error('waiver save failed:', err.message);
    return res.status(502).json({ error: 'save_failed', detail: err.message });
  }
}
