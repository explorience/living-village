// GET /api/auth/callback?token=... -> verifies the magic link, sets the session cookie,
// and bounces crew to /admin, attendees to /portal. Invalid/expired or unknown links
// land back on /portal with an ?error so the page can explain.

import { verifyMagicToken, sessionCookie, isAllowed } from '../_lib/auth.js';
import { ensureSchema, isSignup } from '../_lib/db.js';

export default async function handler(req, res) {
  const token = req.query?.token || '';
  let email = null;
  try { email = verifyMagicToken(token); } catch (err) { console.error('callback verify error:', err.message); }

  if (!email) {
    res.setHeader('Location', '/portal?error=link');
    return res.status(302).end();
  }

  const crew = isAllowed(email);
  let attendee = false;
  if (!crew) {
    try { await ensureSchema(); attendee = await isSignup(email); }
    catch (err) { console.error('callback signup check failed:', err.message); }
  }
  if (!crew && !attendee) {
    res.setHeader('Location', '/portal?error=notfound');
    return res.status(302).end();
  }

  res.setHeader('Set-Cookie', sessionCookie(email));
  res.setHeader('Location', crew ? '/admin' : '/portal');
  return res.status(302).end();
}
