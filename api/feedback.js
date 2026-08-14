// Anonymous-friendly feedback endpoint for the event weekend.
//
// Three paths, best-effort in parallel:
//   1. Append to the "Feedback" tab of the signups spreadsheet (created on first use).
//   2. SMS the message to FEEDBACK_SMS_TO via Twilio.
//   3. If SMS fails and Resend is configured, email the message instead.
// Success = the row was saved OR the message reached a phone/inbox.

const SHEET_ID = '16TL2Bqa4gl8H5R8nQe0JvhQa2IwajeuzLvlcka8l3dI';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = req.body || {};
  if (typeof payload.website === 'string' && payload.website.trim() !== '') {
    // Honeypot field filled: pretend success, save nothing.
    return res.status(200).json({ success: true });
  }
  const message = (typeof payload.message === 'string' ? payload.message : '').trim().slice(0, 2000);
  const name = (typeof payload.name === 'string' ? payload.name : '').trim().slice(0, 100);
  if (!message) return res.status(400).json({ error: 'Message is required' });

  const [sheetResult, smsResult] = await Promise.all([
    writeToSheet(name, message).catch(err => ({ ok: false, error: err.message })),
    sendSms(name, message).catch(err => ({ ok: false, error: err.message })),
  ]);

  let emailResult = { ok: false, skipped: true };
  if (!smsResult.ok) {
    emailResult = await sendEmailFallback(name, message).catch(err => ({ ok: false, error: err.message }));
  }

  const success = sheetResult.ok || smsResult.ok || emailResult.ok;
  console.log('Feedback:', JSON.stringify({ name: name || '(anon)', sheet: sheetResult.ok, sms: smsResult.ok, email: emailResult.ok }));
  if (success) return res.status(200).json({ success: true, sheet: sheetResult.ok, sms: smsResult.ok });

  console.error('Feedback all paths failed:', JSON.stringify({ sheetResult, smsResult, emailResult }));
  return res.status(502).json({ error: 'all_paths_failed' });
}

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GCLIENT_ID,
      client_secret: process.env.GCLIENT_SECRET,
      refresh_token: process.env.GREFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('No access token: ' + JSON.stringify(data));
  return data.access_token;
}

async function writeToSheet(name, message) {
  const token = await getAccessToken();
  const row = [new Date().toISOString(), name, message];
  const append = () => fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Feedback%21A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    }
  );

  let res = await append();
  if (!res.ok) {
    const text = await res.text();
    // First run: the Feedback tab doesn't exist yet. Create it, then retry once.
    if (res.status === 400 && /Unable to parse range/i.test(text)) {
      const create = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'Feedback' } } }] }),
      });
      if (!create.ok) throw new Error('addSheet failed: ' + (await create.text()).slice(0, 300));
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Feedback%21A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [['timestamp', 'name', 'message']] }),
        }
      );
      res = await append();
      if (!res.ok) throw new Error('append retry failed: ' + (await res.text()).slice(0, 300));
      return { ok: true };
    }
    throw new Error('append failed: ' + text.slice(0, 300));
  }
  return { ok: true };
}

async function sendSms(name, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  const to = process.env.FEEDBACK_SMS_TO;
  if (!sid || !auth || !from || !to) return { ok: false, error: 'twilio_not_configured' };

  const body = `TLV feedback from ${name || 'anonymous'}:\n${message}`.slice(0, 1500);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) throw new Error('twilio failed: ' + (await res.text()).slice(0, 300));
  return { ok: true };
}

async function sendEmailFallback(name, message) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'resend_not_configured' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'The Living Village <hello@livingvillage.ca>',
      to: ['1heenal@gmail.com'],
      subject: `TLV feedback from ${name || 'anonymous'}`,
      text: message,
    }),
  });
  if (!res.ok) throw new Error('resend failed: ' + (await res.text()).slice(0, 300));
  return { ok: true };
}
