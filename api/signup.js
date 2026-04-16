const SHEET_ID = '16TL2Bqa4gl8H5R8nQe0JvhQa2IwajeuzLvlcka8l3dI';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, roles, comment, timestamp } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const rowData = [timestamp || new Date().toISOString(), email, name || '', (roles || []).join(', '), comment || ''];

  try {
    // Step 1: Refresh token
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
      console.error('Token refresh HTTP error:', tokenRes.status, errText.substring(0, 200));
      return res.status(502).json({ error: 'auth_failed', stage: 'token_refresh' });
    }

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('No access_token in response:', JSON.stringify(tokenData).substring(0, 200));
      return res.status(502).json({ error: 'auth_failed', stage: 'no_access_token' });
    }

    // Step 2: Write to sheet
    const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Signups%21A%3AE:append?valueInputOption=RAW`;
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
      return res.status(502).json({ error: 'sheet_write_failed', status: sheetRes.status });
    }

    console.log('Sheet write OK for:', email);
    return res.status(200).json({ success: true, message: "Welcome to the village." });
  } catch (err) {
    console.error('Error:', err.message, err.stack?.substring(0, 200));
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
}
