// Magic-link auth for the Living Village admin.
//
// No passwords, no accounts. A small allowlist of emails can request a one-tap link;
// clicking it sets a signed, HttpOnly session cookie. Tokens and sessions are stateless
// HMACs over a server secret (ADMIN_SESSION_SECRET) so there's no session store to keep.

import { createHmac, timingSafeEqual } from 'crypto';

const COOKIE = 'lv_admin';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;   // 30 days
const LINK_TTL = 20 * 60 * 1000;                // 20 minutes (crew)
const ATTENDEE_LINK_TTL = 45 * 24 * 60 * 60 * 1000; // ~6 weeks, through the event (attendees)

export function allowlist() {
  const raw = process.env.ADMIN_ALLOWLIST
    || '1heenal@gmail.com,andre.vashist@gmail.com,hayesrsavannah@gmail.com,oleksandra.makovska99@gmail.com';
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function isAllowed(email) {
  return !!email && allowlist().includes(email.trim().toLowerCase());
}

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error('ADMIN_SESSION_SECRET not configured');
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(s, 'base64url').toString('utf8');

// payload -> "<b64url(json)>.<b64url(hmac)>"
function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac('sha256', secret()).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

function verify(token, expectedPurpose) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, macPart] = token.split('.');
  let expected;
  try { expected = createHmac('sha256', secret()).update(body).digest(); }
  catch { return null; }
  let given;
  try { given = Buffer.from(macPart, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload;
  try { payload = JSON.parse(fromB64url(body)); } catch { return null; }
  if (payload.purpose !== expectedPurpose) return null;
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

export function makeLoginToken(email) {
  return sign({ email: email.trim().toLowerCase(), purpose: 'login', exp: Date.now() + LINK_TTL });
}

// Long-lived login link for attendees (delivered in the invite email / on request).
export function makeAttendeeToken(email) {
  return sign({ email: email.trim().toLowerCase(), purpose: 'login', exp: Date.now() + ATTENDEE_LINK_TTL });
}

export function verifyLoginToken(token) {
  const p = verify(token, 'login');
  return p && isAllowed(p.email) ? p.email : null;
}

// Verify a login token WITHOUT the crew allowlist gate — returns the email for any
// validly-signed, unexpired login token. The caller decides crew vs attendee. Used by
// the callback so both crew and attendee links resolve.
export function verifyMagicToken(token) {
  const p = verify(token, 'login');
  return p ? p.email : null;
}

export function sessionCookie(email) {
  const token = sign({ email: email.trim().toLowerCase(), purpose: 'session', exp: Date.now() + SESSION_TTL });
  const maxAge = Math.floor(SESSION_TTL / 1000);
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Returns { email } for a valid session, else null.
export function getSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`));
  if (!match) return null;
  const token = match.slice(COOKIE.length + 1);
  const p = verify(token, 'session');
  return p && isAllowed(p.email) ? { email: p.email } : null;
}

// Like getSession but WITHOUT the crew gate — returns the email for any valid session
// cookie. Portal endpoints use this; crew endpoints keep using getSession (crew-only),
// so an attendee session can never reach /api/admin/*.
export function readSessionEmail(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`));
  if (!match) return null;
  const p = verify(match.slice(COOKIE.length + 1), 'session');
  return p ? p.email : null;
}

export function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}
