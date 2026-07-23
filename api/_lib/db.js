// Postgres (Neon) layer for the Living Village admin.
//
// The DB is the source of truth for the backend. Applicant DATA is synced in from the
// signups sheet on each admin load (the sheet stays the live intake feed); the ASSIGNMENT
// layer — assigned roles, activities, status, private notes — lives only here and is never
// overwritten by a sheet sync. Built on the Neon serverless (HTTP) driver, which suits
// Vercel functions: no pooling, no sockets to leak.

import { neon } from '@neondatabase/serverless';

// Seed activities (from the TLC site-visit notes + the form); the live list grows from use.
const SEED_ACTIVITIES = [
  'Authentic Relating workshop', 'Natural building demo', 'Permaculture walk',
  'Welcome / registration table', 'Setup & teardown', 'Morning walk',
  'Kitchen & dish duty', 'Fire keeping', 'Music & dance', 'Childcare', 'Opening ceremony',
];

// Find the Postgres connection string regardless of the env var name. The Vercel/Neon
// integration lets you set a custom prefix (e.g. STORAGE_URL, STORAGE_POSTGRES_URL), so we
// check the common names first, then fall back to scanning for any postgres:// value and
// prefer a pooled connection (best fit for the serverless HTTP driver).
export function resolveDbUrl() {
  const named = process.env.DATABASE_URL || process.env.POSTGRES_URL
    || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
  if (named) return named;
  const candidates = Object.values(process.env)
    .filter(v => typeof v === 'string' && /^postgres(ql)?:\/\//.test(v));
  return candidates.find(v => v.includes('-pooler')) || candidates[0] || null;
}

let _sql = null;
function db() {
  if (_sql) return _sql;
  const url = resolveDbUrl();
  if (!url) throw new Error('No database URL configured (DATABASE_URL / POSTGRES_URL / *_URL)');
  _sql = neon(url);
  return _sql;
}

let _schemaReady = false;
export async function ensureSchema() {
  if (_schemaReady) return;
  const sql = db();
  await sql`CREATE TABLE IF NOT EXISTS applicants (
    id                  text PRIMARY KEY,
    email               text,
    name                text,
    applied             timestamptz,
    data                jsonb  NOT NULL DEFAULT '{}'::jsonb,
    assigned_roles      jsonb  NOT NULL DEFAULT '[]'::jsonb,
    assigned_activities jsonb  NOT NULL DEFAULT '[]'::jsonb,
    status              text   NOT NULL DEFAULT '',
    notes               text   NOT NULL DEFAULT '',
    phone               text   NOT NULL DEFAULT '',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    assigned_updated_at timestamptz
  )`;
  // Migrate tables created before the crew-editable phone column existed.
  await sql`ALTER TABLE applicants ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT ''`;
  // Attendee self-service (Portal): what a person adds to their offerings + a free-text
  // "how I want to show up". Kept in dedicated columns so a sheet sync (which overwrites
  // `data`) never clobbers them — same principle as the assignment layer.
  await sql`ALTER TABLE applicants ADD COLUMN IF NOT EXISTS portal_offerings jsonb NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE applicants ADD COLUMN IF NOT EXISTS portal_gifts text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE applicants ADD COLUMN IF NOT EXISTS portal_updated_at timestamptz`;
  _schemaReady = true;
}

// Upsert clean applicant records from the sheet WITHOUT touching the assignment columns.
export async function syncFromSheet(records) {
  const sql = db();
  await Promise.all(records.map(r => sql`
    INSERT INTO applicants (id, email, name, applied, data, updated_at)
    VALUES (${r.id}, ${r.email || null}, ${r.name || null}, ${r.applied || null}, ${JSON.stringify(r)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email, name = EXCLUDED.name, applied = EXCLUDED.applied,
      data = EXCLUDED.data, updated_at = now()
  `));
}

function rowToApplicant(row) {
  return {
    ...row.data,
    id: row.id,
    assignedRoles: Array.isArray(row.assigned_roles) ? row.assigned_roles : [],
    assignedActivities: Array.isArray(row.assigned_activities) ? row.assigned_activities : [],
    status: row.status || '',
    notes: row.notes || '',
    phone: row.phone || '',
    assignedUpdatedAt: row.assigned_updated_at || null,
    portalOfferings: Array.isArray(row.portal_offerings) ? row.portal_offerings : [],
    portalGifts: row.portal_gifts || '',
    portalUpdatedAt: row.portal_updated_at || null,
  };
}

export async function getAllApplicants() {
  const sql = db();
  const rows = await sql`
    SELECT id, data, assigned_roles, assigned_activities, status, notes, phone, assigned_updated_at,
           portal_offerings, portal_gifts, portal_updated_at
    FROM applicants ORDER BY applied DESC NULLS LAST`;
  return rows.map(rowToApplicant);
}

export async function updateAssignment(id, { assignedRoles, assignedActivities, status, notes, phone }) {
  const sql = db();
  const rows = await sql`
    UPDATE applicants SET
      assigned_roles = ${JSON.stringify(assignedRoles)}::jsonb,
      assigned_activities = ${JSON.stringify(assignedActivities)}::jsonb,
      status = ${status}, notes = ${notes}, phone = ${phone},
      assigned_updated_at = now(), updated_at = now()
    WHERE id = ${id}
    RETURNING id, data, assigned_roles, assigned_activities, status, notes, phone, assigned_updated_at`;
  return rows.length ? rowToApplicant(rows[0]) : null;
}

export async function getActivitySuggestions() {
  const sql = db();
  const rows = await sql`SELECT DISTINCT jsonb_array_elements_text(assigned_activities) AS a FROM applicants`;
  const used = rows.map(r => r.a).filter(Boolean);
  return [...new Set([...SEED_ACTIVITIES, ...used])].sort((a, b) => a.localeCompare(b));
}

// --- Attendee Portal (self-service) ---

// Does this email belong to someone who signed up? (case-insensitive)
export async function isSignup(email) {
  if (!email) return false;
  const sql = db();
  const rows = await sql`SELECT 1 FROM applicants WHERE lower(email) = lower(${email}) LIMIT 1`;
  return rows.length > 0;
}

// One applicant by email, with their chosen data (roles/micro live in `data`) + portal additions.
export async function getApplicantByEmail(email) {
  if (!email) return null;
  const sql = db();
  const rows = await sql`
    SELECT id, data, assigned_roles, assigned_activities, status, notes, phone, assigned_updated_at,
           portal_offerings, portal_gifts, portal_updated_at
    FROM applicants WHERE lower(email) = lower(${email}) LIMIT 1`;
  return rows.length ? rowToApplicant(rows[0]) : null;
}

// Append the roles/offerings an attendee adds (add-only: union with what's there) and set
// their free-text gifts (replaced with the latest, since the form is prefilled with it).
export async function addPortalOfferings(email, { offerings = [], gifts = '' }) {
  const sql = db();
  const rows = await sql`SELECT id, portal_offerings FROM applicants WHERE lower(email) = lower(${email}) LIMIT 1`;
  if (!rows.length) return null;
  const existing = Array.isArray(rows[0].portal_offerings) ? rows[0].portal_offerings : [];
  const merged = [...new Set([...existing, ...offerings.filter(Boolean)])];
  await sql`UPDATE applicants SET
      portal_offerings = ${JSON.stringify(merged)}::jsonb,
      portal_gifts = ${String(gifts || '')},
      portal_updated_at = now(), updated_at = now()
    WHERE id = ${rows[0].id}`;
  return { offerings: merged, gifts: String(gifts || '') };
}
