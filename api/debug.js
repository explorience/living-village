import { resolveDbUrl, ensureSchema, syncFromSheet, getAllApplicants, getActivitySuggestions } from './_lib/db.js';
import { readCleanApplicants } from './_lib/sheet.js';

export default async function handler(req, res) {
  // Guarded full-chain DB test: /api/debug?dbtest=lv-diag-9fK3pQ
  // Proves DB connect + sheet read + sync + read without a login. Counts only, no PII.
  // Removed right after diagnosis.
  if (req.query && req.query.dbtest === 'lv-diag-9fK3pQ') {
    try {
      await ensureSchema();
      const clean = await readCleanApplicants();
      await syncFromSheet(clean);
      const [applicants, activities] = await Promise.all([getAllApplicants(), getActivitySuggestions()]);
      return res.status(200).json({
        ok: true,
        sheetCount: clean.length,
        dbCount: applicants.length,
        activitiesCount: activities.length,
      });
    } catch (err) {
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  // Env var names whose value is a Postgres connection string (names only, no values).
  const dbCandidateVars = Object.entries(process.env)
    .filter(([, v]) => typeof v === 'string' && /^postgres(ql)?:\/\//.test(v))
    .map(([k]) => k);

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
    dbResolved: !!resolveDbUrl(),
    dbCandidateVars,
    // All env var NAMES present in this Production runtime (names only, no values) so we can
    // see exactly what the Neon integration created. Filters out Vercel system noise.
    envKeys: Object.keys(process.env)
      .filter(k => !/^(VERCEL|AWS|LAMBDA|NODE|PATH|PWD|HOME|SHLVL|_|TZ|LANG|HOSTNAME|NOW_)/.test(k))
      .sort(),
  });
}
