// POST /api/admin/assign -> save the assignment layer for one applicant (behind a session).
// Body: { id, assignedRoles?: string[], assignedActivities?: string[], status?, notes?, phone? }

import { getSession } from '../_lib/auth.js';
import { ensureSchema, updateAssignment } from '../_lib/db.js';

const STATUSES = ['', 'confirmed', 'maybe', 'waitlist', 'declined'];

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const b = req.body || {};
  if (!b.id || typeof b.id !== 'string') return res.status(400).json({ error: 'missing_id' });

  // Sanitise, never validate against a vocabulary. This used to filter against ROLES,
  // which meant that editing that list retroactively deleted any saved role no longer in
  // it: a crew member opening someone's card and hitting save would silently drop their
  // real picks. The roster UI only ever offers real roles, so the vocabulary buys nothing
  // here, and the cost of getting it wrong is other people's data. Treat it like
  // assignedActivities: trim, dedupe, cap, keep.
  const assignedRoles = Array.isArray(b.assignedRoles)
    ? [...new Set(b.assignedRoles.map(s => String(s).trim()).filter(Boolean))].slice(0, 30) : [];
  const assignedActivities = Array.isArray(b.assignedActivities)
    ? [...new Set(b.assignedActivities.map(s => String(s).trim()).filter(Boolean))].slice(0, 30) : [];
  const status = STATUSES.includes(b.status) ? b.status : '';
  const notes = typeof b.notes === 'string' ? b.notes.slice(0, 4000) : '';
  const phone = typeof b.phone === 'string' ? b.phone.trim().slice(0, 40) : '';

  try {
    await ensureSchema();
    const applicant = await updateAssignment(b.id, { assignedRoles, assignedActivities, status, notes, phone });
    if (!applicant) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ ok: true, applicant });
  } catch (err) {
    console.error('assign save failed:', err.message);
    return res.status(502).json({ error: 'save_failed', detail: err.message });
  }
}
