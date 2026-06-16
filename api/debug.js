export default function handler(req, res) {
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
