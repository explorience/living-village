// Signup API - writes to Google Sheets

const SHEET_ID = '16TL2Bqa4gl8H5R8nQe0JvhQa2IwajeuzLvlcka8l3dI';
const SHEET_NAME = 'Signups';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { email, name, roles, comment, timestamp } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Get fresh Google OAuth token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GCLIENT_ID,
        client_secret: process.env.GCLIENT_SECRET,
        refresh_token: process.env.GREFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Token refresh failed:', tokenData);
      throw new Error('Auth failed');
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
          values: [[timestamp, email, name || '', (roles || []).join(', '), comment || '']],
        }),
      }
    );

    if (!sheetRes.ok) {
      const err = await sheetRes.text();
      console.error('Sheet write failed:', err);
      throw new Error('Sheet write failed');
    }

    return res.status(200).json({ success: true, message: 'Welcome to the village.' });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}
