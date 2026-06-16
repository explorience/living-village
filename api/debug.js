export default async function handler(req, res) {
  // Guarded one-shot live Resend test: /api/debug?resendtest=lv-diag-9fK3pQ
  // Surfaces Resend's actual HTTP status + body so we can see why the magic link fails.
  // Removed right after diagnosis.
  if (req.query && req.query.resendtest === 'lv-diag-9fK3pQ') {
    try {
      const from = process.env.RESEND_FROM || 'The Living Village <onboarding@resend.dev>';
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: ['1heenal@gmail.com'], subject: 'LV resend diagnostic', text: 'diagnostic' }),
      });
      const body = await r.text();
      return res.status(200).json({ resendStatus: r.status, resendBody: body.slice(0, 500), from });
    } catch (err) {
      return res.status(200).json({ resendError: err.message });
    }
  }

  return res.status(200).json({
    hasClientId: !!process.env.GCLIENT_ID,
    hasSecret: !!process.env.GCLIENT_SECRET,
    hasRefresh: !!process.env.GREFRESH_TOKEN,
    clientIdStart: process.env.GCLIENT_ID ? process.env.GCLIENT_ID.substring(0, 15) : 'MISSING',
    nodeEnv: process.env.NODE_ENV,
    // Presence-only checks for the admin backend (no secret values leaked).
    hasResendKey: !!process.env.RESEND_API_KEY,
    resendFrom: process.env.RESEND_FROM || '(unset -> onboarding@resend.dev)',
    hasResendTo: !!process.env.RESEND_TO,
    hasSessionSecret: !!process.env.ADMIN_SESSION_SECRET,
    hasDatabaseUrl: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL
      || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING),
    dbVar: process.env.DATABASE_URL ? 'DATABASE_URL'
      : process.env.POSTGRES_URL ? 'POSTGRES_URL'
      : process.env.DATABASE_URL_UNPOOLED ? 'DATABASE_URL_UNPOOLED'
      : process.env.POSTGRES_URL_NON_POOLING ? 'POSTGRES_URL_NON_POOLING' : 'NONE',
  });
}
