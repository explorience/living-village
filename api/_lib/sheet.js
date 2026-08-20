// Shared Google Sheets reader for the Living Village admin.
//
// The signups sheet is the live intake feed: every form submission appends a row,
// including ~2 orphan "partial" saves per person (captured before they finish) and
// the occasional duplicate "[follow-up]" final. This module reads the raw sheet and
// collapses it to one clean record per real applicant, so the admin always sees the
// true roster regardless of the noise below it.
//
// The same dedupe logic is what a future DB backfill should use as its source of truth.

const SHEET_ID = '16TL2Bqa4gl8H5R8nQe0JvhQa2IwajeuzLvlcka8l3dI';
const RANGE = 'Signups!A:Y';

// Column order matches writeToSheet() in api/signup.js (25 columns, A..Y).
const COLS = [
  'timestamp', 'email', 'name', 'roles', 'comment', 'amount', 'micro', 'vow',
  'dietary', 'accessibility', 'paymentIntentId', 'why', 'pathPosition', 'pathNote',
  'topicsYes', 'topicsCurious', 'topicsSkip', 'topicCoCreator', 'topicOther',
  'spectrums', 'bravePrompt', 'bigQuestion', 'solsticeRsvp', 'orientation', 'stage',
];

// Every role/offering value that has ever been saved, across both vocabularies:
// the eight named village roles (the join form) and the five practical offerings
// (the portal). This is a superset on purpose.
//
// This list is the COLUMN SET for Backstage's "By role" board. A value missing here has
// no column, so everyone who picked it disappears from that view even though their record
// is fine. That is exactly what happened 24-28 Jul: this was trimmed to the five practical
// offerings, the board lost its eight named columns, and people reported their signups as
// "deleted". Add to this list; don't prune it.
//
// It is no longer used to validate saves (see api/admin/assign.js), so a stale entry here
// can hide people but can no longer destroy anything.
export const ROLES = [
  // Named village roles — chosen at signup on the join form.
  'Fire Keeper',
  'Story Weaver',
  'Nourishment Steward',
  'Basecamp Steward',
  'Threshold Keeper',
  'Exchange Guide',
  'Flow Facilitator',
  'Not sure yet',
  // Practical offerings — added later in the portal.
  'Food related',
  'Firewood',
  'Games',
  'Instruments',
  'Arts and crafts',
];

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GCLIENT_ID,
      client_secret: process.env.GCLIENT_SECRET,
      refresh_token: process.env.GREFRESH_TOKEN,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`google_token_failed ${res.status}: ${txt.slice(0, 160)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('google_token_no_access_token');
  return data.access_token;
}

// Returns the raw 2D array of cell values (including the header row).
export async function fetchRawRows() {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(RANGE)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`sheet_read_failed ${res.status}: ${txt.slice(0, 160)}`);
  }
  const data = await res.json();
  return data.values || [];
}

function rowToObj(row) {
  const o = {};
  COLS.forEach((key, i) => { o[key] = (row[i] != null ? String(row[i]) : '').trim(); });
  return o;
}

// Roles, micro-offerings: short phrases with no internal commas -> safe to split on comma.
function splitList(s) {
  return s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];
}

function safeJson(s) {
  if (!s) return null;
  try { const v = JSON.parse(s); return (v && typeof v === 'object' && Object.keys(v).length) ? v : null; }
  catch { return null; }
}

const FOLLOWUP_RE = /^\\?\[follow-up\\?\]$/i;
function cleanScalar(s) {
  if (!s) return '';
  return FOLLOWUP_RE.test(s.trim()) ? '' : s.trim();
}

function isPartial(o) { return o.stage.toLowerCase().startsWith('partial'); }
function isTest(o) { return /test/i.test(o.vow); }
function isEmptyShell(o) {
  // e.g. the seed row with only an email and nothing else.
  return !o.name && !o.vow && !o.why && !o.comment && splitList(o.roles).length === 0;
}

// Collapse multiple rows for the same person into one maximally-complete record.
function mergeGroup(rows) {
  const longestScalar = (field) => {
    const vals = rows.map(r => cleanScalar(r[field])).filter(Boolean);
    return vals.sort((a, b) => b.length - a.length)[0] || '';
  };
  const longestList = (field) => {
    const lists = rows.map(r => splitList(r[field]));
    return lists.sort((a, b) => b.length - a.length)[0] || [];
  };
  const firstJson = (field) => {
    for (const r of rows) { const v = safeJson(r[field]); if (v) return v; }
    return null;
  };
  const appliedIso = rows.map(r => r.timestamp).filter(Boolean).sort()[0] || '';

  return {
    id: (rows.find(r => r.email)?.email || longestScalar('name') || appliedIso).toLowerCase(),
    email: rows.find(r => r.email)?.email || '',
    // The name field is optional on the join form, but the vow is signed by hand and is
    // always a real name. Falling back to it here (rather than only in the roster UI) keeps
    // a person findable everywhere downstream: the DB name column, CSV export, the email
    // compose list. Without it they read as blank and look like a lost signup.
    name: longestScalar('name') || longestScalar('vow'),
    applied: appliedIso,
    appliedMs: appliedIso ? Date.parse(appliedIso) : 0,
    roles: longestList('roles'),
    micro: longestList('micro'),
    comment: longestScalar('comment'),
    vow: longestScalar('vow'),
    why: longestScalar('why'),
    pathPosition: longestScalar('pathPosition'),
    pathNote: longestScalar('pathNote'),
    topicsYes: longestScalar('topicsYes'),
    topicsCurious: longestScalar('topicsCurious'),
    topicsSkip: longestScalar('topicsSkip'),
    topicCoCreator: longestScalar('topicCoCreator'),
    topicOther: longestScalar('topicOther'),
    bravePrompt: longestScalar('bravePrompt'),
    bigQuestion: longestScalar('bigQuestion'),
    dietary: longestScalar('dietary'),
    accessibility: longestScalar('accessibility'),
    solsticeRsvp: rows.some(r => /yes/i.test(r.solsticeRsvp)),
    // Someone who left their name on the post-gathering "stay in touch" form rather than
    // registering for the August weekend. `every`, not `some`, on purpose: if a real
    // attendee also fills that form in, their attendee rows outrank it and they stay an
    // attendee. Only a person whose every row is an interest row is interest-only.
    interestOnly: rows.every(r => r.stage.trim().toLowerCase() === 'interest'),
    orientation: firstJson('orientation'),
    spectrums: firstJson('spectrums'),
  };
}

// Raw rows (incl. header) -> array of clean applicant records (one per real person).
export function dedupeRows(rawRows) {
  const dataRows = rawRows
    .map(rowToObj)
    .filter(o => o.timestamp && o.timestamp.toLowerCase() !== 'timestamp'); // drop header / blanks

  const real = dataRows.filter(o => !isPartial(o) && !isTest(o) && !isEmptyShell(o));

  const groups = new Map();
  for (const o of real) {
    const key = (o.email || `name:${o.name}|${o.timestamp}`).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  return [...groups.values()]
    .map(mergeGroup)
    .sort((a, b) => b.appliedMs - a.appliedMs); // newest first
}

export async function readCleanApplicants() {
  const rows = await fetchRawRows();
  return dedupeRows(rows);
}
