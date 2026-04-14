// Signup API - writes to Google Sheets
const SHEET_ID = '16TL2Bqa4gl8H5R8nQe0JvhQa2IwajeuzLvlcka8l3dI';
const SHEET_NAME = 'Signups';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, roles, comment, timestamp } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const clientId = process.env.GCLIENT_ID;
    const clientSecret = process.env.GCLIENT_SECRET;
    const refreshToken = process.env.GREFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      console.error('Missing env vars:', { clientId: !!clientId, clientSecret: !!clientSecret, refreshToken: !!refreshToken });
      // Still return success to user, store locally
      console.log('SIGNUP (no sheet):', JSON.stringify({ email, name, roles, comment, timestamp }));
      return res.status(200).json({ success: true, message: "Welcome to the village." });
    }

    // Get fresh Google OAuth token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Token refresh failed:', JSON.stringify(tokenData));
      console.log('SIGNUP (auth failed):', JSON.stringify({ email, name, roles, comment, timestamp }));
      return res.status(200).json({ success: true, message: "Welcome to the village." });
    }

    // Write to Google Sheet
    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:E:append?valueInputOption=RAW`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[timestamp || new Date().toISOString(), email, name || '', (roles || []).join(', '), comment || '']],
        }),
      }
    );

    if (!sheetRes.ok) {
      const errText = await sheetRes.text();
      console.error('Sheet write failed:', errText);
      console.log('SIGNUP (sheet failed):', JSON.stringify({ email, name, roles, comment, timestamp }));
    }

    return res.status(200).json({ success: true, message: "Welcome to the village." });
  } catch (err) {
    console.error('Signup error:', err);
    // Graceful degradation - still log and return success
    console.log('SIGNUP (error):', JSON.stringify({ email, name, roles, comment, timestamp }));
    return res.status(200).json({ success: true, message: "Welcome to the village." });
  }
}
