// One-off verification for the /reflect storage layer. Uses the app's own resolveDbUrl,
// so it connects exactly the way the deployed functions do.
//   node --env-file=.env.local notes/verify-reflections.mjs          # report
//   node --env-file=.env.local notes/verify-reflections.mjs --purge-before <ISO> --yes
import { neon } from '@neondatabase/serverless';
import { resolveDbUrl } from '../api/_lib/db.js';

// `vercel env pull` writes values wrapped in quotes, which the real Vercel runtime never
// does. Strip them here so this script connects the same way the deployed function does.
const raw = resolveDbUrl();
const url = String(raw || '').trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error('No usable postgres URL found in env (got a value of length ' + url.length + ')');
  process.exit(1);
}
const sql = neon(url);

const rows = await sql`SELECT id, name, email, answers, completed, created_at, updated_at
                       FROM reflections ORDER BY created_at`;
console.log('rows in reflections:', rows.length);
for (const r of rows) {
  console.log(`  ${r.id}  name=${JSON.stringify(r.name)}  completed=${r.completed}`);
  console.log(`    answers=${JSON.stringify(r.answers)}`);
}

const test = rows.filter(r => r.id.includes('zztest'));
const bot  = rows.filter(r => r.id.includes('zzbot'));
const big  = rows.filter(r => r.id.includes('zzbig'));
console.log('');
console.log('upsert did not duplicate :', test.length === 1 ? 'PASS' : `FAIL (${test.length} rows)`);
console.log('completed stayed true    :', test[0]?.completed === true ? 'PASS' : 'FAIL');
console.log('answers took latest value:', test[0]?.answers?.stayed === 'final' ? 'PASS' : 'FAIL');
console.log('honeypot row not created :', bot.length === 0 ? 'PASS' : 'FAIL');
console.log('oversized row not created:', big.length === 0 ? 'PASS' : 'FAIL');

// Purging by id prefix only catches the rows made with curl. The ones the browser created
// during testing have ordinary minted ids (rf_msx...), so the reliable cut is by time:
// everything written before the form was sent to anyone is a test row by definition.
//   node --env-file=... notes/verify-reflections.mjs --purge-before 2026-08-18T00:00:00Z
const i = process.argv.indexOf('--purge-before');
if (i !== -1) {
  const cutoff = process.argv[i + 1];
  if (!cutoff || Number.isNaN(Date.parse(cutoff))) {
    console.error('\n--purge-before needs an ISO timestamp, e.g. 2026-08-18T00:00:00Z');
    process.exit(1);
  }
  const doomed = await sql`SELECT id, name, created_at FROM reflections WHERE created_at < ${cutoff}`;
  console.log(`\nabout to delete ${doomed.length} row(s) created before ${cutoff}:`);
  for (const d of doomed) console.log(`  ${d.id}  ${JSON.stringify(d.name)}  ${d.created_at.toISOString()}`);
  if (!process.argv.includes('--yes')) {
    console.log('\nDry run. Add --yes to actually delete.');
  } else {
    const del = await sql`DELETE FROM reflections WHERE created_at < ${cutoff} RETURNING id`;
    console.log('\ndeleted:', del.length);
    const left = await sql`SELECT count(*)::int AS n FROM reflections`;
    console.log('rows remaining:', left[0].n);
  }
}
