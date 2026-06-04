const SHEET_ID = '16TL2Bqa4gl8H5R8nQe0JvhQa2IwajeuzLvlcka8l3dI';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = req.body || {};
  const { email, stage } = payload;

  // Partial saves (stage starts with 'partial') are orphan rows captured mid-flow,
  // before the user has reached the Vow moment where email is collected.
  const isPartial = typeof stage === 'string' && stage.startsWith('partial');
  if (!isPartial && !email) return res.status(400).json({ error: 'Email is required' });

  // Run Sheets write and backup email in parallel. Either succeeding is enough to
  // count as success. Email always sends (when RESEND_API_KEY is configured) so the
  // team has redundant visibility and a fallback if Sheets ever breaks.
  const tasks = [
    writeToSheet(payload).catch(err => ({ ok: false, reason: 'exception', error: err.message })),
    sendBackupEmail(payload).catch(err => ({ ok: false, reason: 'exception', error: err.message })),
  ];
  // Send a warm confirmation to the applicant only on a real final submission —
  // not partial saves, and not the post-welcome "big question" follow-up (which sends no stage).
  if (stage === 'final' && email) {
    tasks.push(sendApplicantConfirmation(payload).catch(err => ({ ok: false, reason: 'exception', error: err.message })));
  }
  const [sheetResult, emailResult] = await Promise.all(tasks);

  // The applicant confirmation never affects success — the signup is recorded if Sheets or the backup email worked.
  const success = sheetResult.ok || emailResult.ok;
  if (success) {
    console.log('Signup recorded:', email || '(no email)', 'sheet=' + sheetResult.ok, 'email=' + emailResult.ok);
    return res.status(200).json({
      success: true,
      message: 'Welcome to the village.',
      sheet: sheetResult.ok,
      email: emailResult.ok,
    });
  }

  console.error('Both paths failed for:', email || '(no email)', 'sheet=', sheetResult, 'email=', emailResult);
  return res.status(502).json({
    error: 'all_paths_failed',
    sheet: sheetResult,
    email: emailResult,
  });
}

async function writeToSheet(payload) {
  const {
    email, name, roles, comment, timestamp,
    micro, amount, vow, dietary, accessibility, paymentIntentId,
    why, pathPosition, pathNote,
    topicsYes, topicsCurious, topicsSkip,
    topicCoCreator, topicOther,
    spectrums, orientation,
    bravePrompt, bigQuestion, solsticeRsvp,
    stage,
  } = payload;

  const formatTopicCoCreator = (entries) => {
    if (!entries || typeof entries !== 'object') return '';
    return Object.entries(entries)
      .filter(([, note]) => note && String(note).trim())
      .map(([topic, note]) => `${topic} — ${String(note).trim()}`)
      .join('; ');
  };

  const rowData = [
    timestamp || new Date().toISOString(),
    email || '',
    name || '',
    (roles || []).join(', '),
    comment || '',
    amount != null ? String(amount) : '',
    (micro || []).join(', '),
    vow || '',
    dietary || '',
    accessibility || '',
    paymentIntentId || '',
    why || '',
    pathPosition || '',
    pathNote || '',
    (topicsYes || []).join(', '),
    (topicsCurious || []).join(', '),
    (topicsSkip || []).join(', '),
    formatTopicCoCreator(topicCoCreator),
    topicOther || '',
    spectrums ? JSON.stringify(spectrums) : '',
    bravePrompt || '',
    bigQuestion || '',
    solsticeRsvp ? 'yes' : '',
    orientation && Object.keys(orientation).length ? JSON.stringify(orientation) : '',
    stage || 'final',
  ];

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GCLIENT_ID,
      client_secret: process.env.GCLIENT_SECRET,
      refresh_token: process.env.GREFRESH_TOKEN,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    let googleError = null;
    try { googleError = JSON.parse(errText); } catch (e) { googleError = { raw: errText.substring(0, 200) }; }
    console.error('Sheet auth failed:', tokenRes.status, errText.substring(0, 200));
    return { ok: false, reason: 'auth_failed', stage: 'token_refresh', google: googleError };
  }

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.error('Sheet auth: no access_token in response');
    return { ok: false, reason: 'auth_failed', stage: 'no_access_token' };
  }

  // Anchor the append to a single cell (A1) + INSERT_ROWS so Sheets always writes a full
  // row starting at column A. Appending to a wide range (A:Y) let Sheets' table auto-detection
  // drift on sparse rows and start writing at column Y — this prevents that. Keep %21 = '!'.
  const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Signups%21A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const sheetRes = await fetch(sheetUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [rowData] }),
  });

  if (!sheetRes.ok) {
    const errText = await sheetRes.text();
    console.error('Sheet write error:', sheetRes.status, errText.substring(0, 300));
    return { ok: false, reason: 'sheet_write_failed', status: sheetRes.status };
  }

  return { ok: true };
}

async function sendBackupEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: 'not_configured' };
  }
  const fromAddr = process.env.RESEND_FROM || 'Living Village <onboarding@resend.dev>';
  const toAddr = process.env.RESEND_TO || 'hello@journeyland.ca';

  const subject = buildSubject(payload);
  const text = buildHumanSummary(payload) + '\n\n--- Raw JSON ---\n' + JSON.stringify(payload, null, 2);

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddr,
      to: Array.isArray(toAddr) ? toAddr : [toAddr],
      reply_to: payload.email || undefined,
      subject,
      text,
    }),
  });

  if (!r.ok) {
    const errText = await r.text();
    console.error('Email backup failed:', r.status, errText.substring(0, 300));
    return { ok: false, reason: 'send_failed', status: r.status };
  }
  return { ok: true };
}

// Warm, applicant-facing confirmation sent on a final submission. Failure here is logged
// but never blocks the signup (success is decided by the Sheet + backup-email paths).
async function sendApplicantConfirmation(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: 'not_configured' };
  if (!payload.email) return { ok: false, reason: 'no_recipient' };

  const fromAddr = process.env.RESEND_FROM || 'The Living Village <onboarding@resend.dev>';
  const replyToRaw = process.env.RESEND_TO || 'hello@journeyland.ca';
  const replyTo = Array.isArray(replyToRaw) ? replyToRaw[0] : replyToRaw;

  const firstName = firstNameFrom(payload);
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';

  const text = [
    greeting,
    '',
    'Your yes landed. Thank you for the care you put into your answers — we read every one.',
    '',
    'The Living Village gathers on the land, August 15–16, 2026. Hold the dates. We’ll be in touch before then with arrival details, what to bring, and how the two days will flow.',
    '',
    'Until then: this isn’t a ticket you bought, it’s a village you’re helping make. If something stirs, or you think of something you’d love to bring, just reply to this email — it reaches us directly.',
    '',
    'See you on the land,',
    'The Living Village',
  ].join('\n');

  const greetingHtml = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#2c2a26;line-height:1.6;font-size:16px;">
  <p>${greetingHtml}</p>
  <p>Your <strong>yes</strong> landed. Thank you for the care you put into your answers — we read every one.</p>
  <p><strong>The Living Village</strong> gathers on the land, <strong>August&nbsp;15&ndash;16,&nbsp;2026.</strong> Hold the dates. We&rsquo;ll be in touch before then with arrival details, what to bring, and how the two days will flow.</p>
  <p>Until then: this isn&rsquo;t a ticket you bought, it&rsquo;s a village you&rsquo;re helping make. If something stirs, or you think of something you&rsquo;d love to bring, just reply to this email — it reaches us directly.</p>
  <p style="margin-top:24px;">See you on the land,<br><strong>The Living Village</strong></p>
</div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddr,
      to: [payload.email],
      reply_to: replyTo,
      subject: 'Your yes is received 🌱 — The Living Village, Aug 15–16',
      text,
      html,
    }),
  });

  if (!r.ok) {
    const errText = await r.text();
    console.error('Applicant confirmation failed:', r.status, errText.substring(0, 300));
    return { ok: false, reason: 'send_failed', status: r.status };
  }
  return { ok: true };
}

function firstNameFrom(p) {
  const raw = String(p.vow || p.name || '').trim();
  if (!raw) return '';
  return raw.split(/[\s,]+/)[0];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildSubject(p) {
  const stageTag = !p.stage || p.stage === 'final' ? 'yes' : p.stage;
  const who = p.email || p.name || '(no email yet)';
  return `[Living Village] ${stageTag}: ${who}`;
}

function buildHumanSummary(p) {
  const L = [];
  const add = (label, value) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return;
    L.push(`${label}: ${formatValue(value)}`);
  };
  L.push(`Stage: ${p.stage || 'final'}`);
  L.push(`Time:  ${p.timestamp || new Date().toISOString()}`);
  L.push('');
  add('Name', p.name);
  add('Email', p.email);
  add('Vow signature', p.vow);
  L.push('');
  add('Why pulled here', p.why);
  add('Path positions', p.pathPosition);
  add('About where they live', p.pathNote);
  L.push('');
  add('Topics: Yes', p.topicsYes);
  add('Topics: Curious', p.topicsCurious);
  add('Topics: Skip', p.topicsSkip);
  add('Topic co-creator notes', p.topicCoCreator);
  add('Topic: other', p.topicOther);
  L.push('');
  add('Roles', p.roles);
  add('Smaller offerings', p.micro);
  add('Offer', p.comment);
  add('Solstice RSVP', p.solsticeRsvp ? 'YES (June 20 work-bee)' : null);
  L.push('');
  add('Orientation sliders', p.orientation);
  add('Brave-honesty prompt', p.bravePrompt);
  add('Big question reflection', p.bigQuestion);
  L.push('');
  add('Dietary', p.dietary);
  add('Accessibility', p.accessibility);
  return L.join('\n');
}

function formatValue(v) {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') {
    return '\n' + Object.entries(v)
      .map(([k, vv]) => `  - ${k}: ${typeof vv === 'object' ? JSON.stringify(vv) : vv}`)
      .join('\n');
  }
  return String(v);
}
