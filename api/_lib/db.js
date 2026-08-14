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
  // Crew-editable copy for the app's automated emails (RSVP confirmation, sign-in link).
  // One row per template key; a missing row means "use the built-in default" (see _lib/emails.js).
  // Signed participant waivers. Deliberately NOT a column on `applicants`: people who must
  // sign include walk-ins, plus-ones, crew, facilitators and land hosts who were never in the
  // roster, and a guardian signs on behalf of minors. Each row also snapshots the exact
  // wording that person agreed to (`waiver_text`), so a later edit to the copy can never
  // change what an existing signature means.
  await sql`CREATE TABLE IF NOT EXISTS waivers (
    id              text PRIMARY KEY,
    name            text NOT NULL DEFAULT '',
    email           text NOT NULL DEFAULT '',
    phone           text NOT NULL DEFAULT '',
    emergency_name  text NOT NULL DEFAULT '',
    emergency_phone text NOT NULL DEFAULT '',
    medical         text NOT NULL DEFAULT '',
    minors          jsonb NOT NULL DEFAULT '[]'::jsonb,
    photo_consent   boolean NOT NULL DEFAULT true,
    signature       text NOT NULL DEFAULT '',
    waiver_version  text NOT NULL DEFAULT '',
    waiver_text     text NOT NULL DEFAULT '',
    user_agent      text NOT NULL DEFAULT '',
    signed_at       timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS waivers_email_idx ON waivers (lower(email))`;
  await sql`CREATE TABLE IF NOT EXISTS email_templates (
    key         text PRIMARY KEY,
    subject     text NOT NULL DEFAULT '',
    body        text NOT NULL DEFAULT '',
    reply_to    text NOT NULL DEFAULT '',
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text NOT NULL DEFAULT ''
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

// --- Participant waivers ---

// Record one signature. Re-signing with the same email is allowed and creates a NEW row:
// the history is append-only, so nothing that was already agreed to is ever overwritten.
export async function saveWaiver(w) {
  await ensureSchema();
  const sql = db();
  const rows = await sql`
    INSERT INTO waivers (id, name, email, phone, emergency_name, emergency_phone, medical,
                         minors, photo_consent, signature, waiver_version, waiver_text, user_agent)
    VALUES (${w.id}, ${w.name}, ${w.email}, ${w.phone}, ${w.emergencyName}, ${w.emergencyPhone},
            ${w.medical}, ${JSON.stringify(w.minors || [])}::jsonb, ${w.photoConsent},
            ${w.signature}, ${w.waiverVersion}, ${w.waiverText}, ${w.userAgent})
    RETURNING id, name, email, signed_at`;
  return rows[0];
}

export async function getAllWaivers() {
  await ensureSchema();
  const sql = db();
  const rows = await sql`
    SELECT id, name, email, phone, emergency_name, emergency_phone, medical, minors,
           photo_consent, signature, waiver_version, signed_at
    FROM waivers ORDER BY signed_at DESC`;
  return rows.map(r => ({
    id: r.id, name: r.name, email: r.email, phone: r.phone,
    emergencyName: r.emergency_name, emergencyPhone: r.emergency_phone,
    medical: r.medical, minors: Array.isArray(r.minors) ? r.minors : [],
    photoConsent: r.photo_consent, signature: r.signature,
    waiverVersion: r.waiver_version, signedAt: r.signed_at,
  }));
}

// --- Editable email templates (raw storage; the registry + rendering live in _lib/emails.js) ---

export async function getEmailTemplateRow(key) {
  await ensureSchema();
  const sql = db();
  const rows = await sql`
    SELECT key, subject, body, reply_to, updated_at, updated_by
    FROM email_templates WHERE key = ${key} LIMIT 1`;
  return rows.length ? rows[0] : null;
}

export async function getAllEmailTemplateRows() {
  await ensureSchema();
  const sql = db();
  return sql`SELECT key, subject, body, reply_to, updated_at, updated_by FROM email_templates`;
}

export async function saveEmailTemplateRow(key, { subject, body, replyTo }, email) {
  await ensureSchema();
  const sql = db();
  const rows = await sql`
    INSERT INTO email_templates (key, subject, body, reply_to, updated_by, updated_at)
    VALUES (${key}, ${subject}, ${body}, ${replyTo}, ${email || ''}, now())
    ON CONFLICT (key) DO UPDATE SET
      subject = EXCLUDED.subject, body = EXCLUDED.body, reply_to = EXCLUDED.reply_to,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING key, subject, body, reply_to, updated_at, updated_by`;
  return rows[0];
}
