// Signup API - writes to Google Sheets
const SHEET_ID = '16TL2Bqa4gl8H5R8nQe0JvhQa2IwajeuzLvlcka8l3dI';
const SHEET_NAME = 'Signups';

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
    const clientId = process.env.GCLIENT_ID;
    const clientSecret = process.env.GCLIENT_SECRET;
    const refreshToken = process.env.GREFRESH_TOKEN;

    console.log('Env check:', { hasId: !!clientId, hasSecret: !!clientSecret, hasRefresh: !!refreshToken });

    if (!clientId || !clientSecret || !refreshToken) {
      console.error('Missing env vars - cannot write to sheet');
      console.log('SIGNUP:', JSON.stringify(rowData));
      return res.status(200).json({ success: true, message: "Welcome to the village." });
    }

    // Refresh Google OAuth token
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Token refresh failed:', JSON.stringify(tokenData).substring(0, 200));
      return res.status(200).json({ success: true, message: "Welcome to the village." });
    }

    // Write to Google Sheet
    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_NAME + '!A:E')}:append?valueInputOption=RAW`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [rowData] }),
      }
    );

    if (!sheetRes.ok) {
      const errText = await sheetRes.text();
      console.error('Sheet write failed:', sheetRes.status, errText.substring(0, 300));
    } else {
      console.log('Sheet write SUCCESS for:', email);
    }

    return res.status(200).json({ success: true, message: "Welcome to the village." });
  } catch (err) {
    console.error('Signup error:', err.message);
    return res.status(200).json({ success: true, message: "Welcome to the village." });
  }
}
