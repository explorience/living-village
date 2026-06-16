// GET /api/auth/callback?token=... -> verifies the magic link, sets the session
// cookie, and bounces to /admin. Invalid/expired links land on /admin?error=link.

import { verifyLoginToken, sessionCookie } from '../_lib/auth.js';

export default async function handler(req, res) {
  const token = req.query?.token || '';
  let email = null;
  try { email = verifyLoginToken(token); } catch (err) { console.error('callback verify error:', err.message); }

  if (!email) {
    res.setHeader('Location', '/admin?error=link');
    return res.status(302).end();
  }
  res.setHeader('Set-Cookie', sessionCookie(email));
  res.setHeader('Location', '/admin');
  return res.status(302).end();
}
