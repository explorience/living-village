// One-off verification for the /reflect storage layer. Uses the app's own resolveDbUrl,
// so it connects exactly the way the deployed functions do.
//   node --env-file=.env.local notes/verify-reflections.mjs          # report
//   node --env-file=.env.local notes/verify-reflections.mjs --purge  # delete zz test rows
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

if (process.argv.includes('--purge')) {
  const del = await sql`DELETE FROM reflections WHERE id LIKE 'rf_zz%' RETURNING id`;
  console.log('\npurged test rows:', del.length, del.map(d => d.id).join(', ') || '(none)');
  const left = await sql`SELECT count(*)::int AS n FROM reflections`;
  console.log('rows remaining:', left[0].n);
}
