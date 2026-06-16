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

let _sql = null;
function db() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
    || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error('No database URL configured (DATABASE_URL / POSTGRES_URL)');
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
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    assigned_updated_at timestamptz
  )`;
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
    assignedUpdatedAt: row.assigned_updated_at || null,
  };
}

export async function getAllApplicants() {
  const sql = db();
  const rows = await sql`
    SELECT id, data, assigned_roles, assigned_activities, status, notes, assigned_updated_at
    FROM applicants ORDER BY applied DESC NULLS LAST`;
  return rows.map(rowToApplicant);
}

export async function updateAssignment(id, { assignedRoles, assignedActivities, status, notes }) {
  const sql = db();
  const rows = await sql`
    UPDATE applicants SET
      assigned_roles = ${JSON.stringify(assignedRoles)}::jsonb,
      assigned_activities = ${JSON.stringify(assignedActivities)}::jsonb,
      status = ${status}, notes = ${notes},
      assigned_updated_at = now(), updated_at = now()
    WHERE id = ${id}
    RETURNING id, data, assigned_roles, assigned_activities, status, notes, assigned_updated_at`;
  return rows.length ? rowToApplicant(rows[0]) : null;
}

export async function getActivitySuggestions() {
  const sql = db();
  const rows = await sql`SELECT DISTINCT jsonb_array_elements_text(assigned_activities) AS a FROM applicants`;
  const used = rows.map(r => r.a).filter(Boolean);
  return [...new Set([...SEED_ACTIVITIES, ...used])].sort((a, b) => a.localeCompare(b));
}
