// GET /api/admin/applicants -> the roster from the DB (source of truth), behind a session.
// On each load we sync the sheet's clean records into the DB (intake feed -> DB), preserving
// the assignment layer, then return the DB rows with their assignments + activity suggestions.

import { getSession } from '../_lib/auth.js';
import { readCleanApplicants, ROLES } from '../_lib/sheet.js';
import { ensureSchema, syncFromSheet, getAllApplicants, getActivitySuggestions } from '../_lib/db.js';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });

  try {
    await ensureSchema();
    const clean = await readCleanApplicants();   // deduped, from the sheet
    await syncFromSheet(clean);                   // upsert into DB; assignments untouched
    const [applicants, activities] = await Promise.all([getAllApplicants(), getActivitySuggestions()]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ me: session.email, roles: ROLES, activities, applicants });
  } catch (err) {
    console.error('applicants read failed:', err.message);
    return res.status(502).json({ error: 'read_failed', detail: err.message });
  }
}
