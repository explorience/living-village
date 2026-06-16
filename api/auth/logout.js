// GET /api/auth/logout -> clears the session cookie and returns to /admin.

import { clearCookie } from '../_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Set-Cookie', clearCookie());
  res.setHeader('Location', '/admin');
  return res.status(302).end();
}
