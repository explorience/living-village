// POST /api/admin/assign -> save the assignment layer for one applicant (behind a session).
// Body: { id, assignedRoles?: string[], assignedActivities?: string[], status?, notes? }

import { getSession } from '../_lib/auth.js';
import { ensureSchema, updateAssignment } from '../_lib/db.js';
import { ROLES } from '../_lib/sheet.js';

const STATUSES = ['', 'confirmed', 'maybe', 'waitlist', 'declined'];

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const b = req.body || {};
  if (!b.id || typeof b.id !== 'string') return res.status(400).json({ error: 'missing_id' });

  const assignedRoles = Array.isArray(b.assignedRoles)
    ? b.assignedRoles.filter(r => ROLES.includes(r)) : [];
  const assignedActivities = Array.isArray(b.assignedActivities)
    ? [...new Set(b.assignedActivities.map(s => String(s).trim()).filter(Boolean))].slice(0, 30) : [];
  const status = STATUSES.includes(b.status) ? b.status : '';
  const notes = typeof b.notes === 'string' ? b.notes.slice(0, 4000) : '';

  try {
    await ensureSchema();
    const applicant = await updateAssignment(b.id, { assignedRoles, assignedActivities, status, notes });
    if (!applicant) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ ok: true, applicant });
  } catch (err) {
    console.error('assign save failed:', err.message);
    return res.status(502).json({ error: 'save_failed', detail: err.message });
  }
}
