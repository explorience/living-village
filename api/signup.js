const SHEET_ID = '16TL2Bqa4gl8H5R8nQe0JvhQa2IwajeuzLvlcka8l3dI';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    // Original homepage form (still supported)
    email, name, roles, comment, timestamp,
    // Original /join/ extras (still supported; financial fields kept for future use)
    micro, amount, vow, dietary, accessibility, paymentIntentId,
    // /join/ v2 redesign — open prompts, paths, topics, spectrums, big question, solstice
    why,
    pathPosition, pathNote,
    topicsYes, topicsCurious, topicsSkip,
    topicCoCreator, topicOther,
    spectrums,
    orientation,
    bravePrompt,
    bigQuestion,
    solsticeRsvp,
    stage,
  } = req.body;
  // Partial saves (stage starts with 'partial') are orphan rows captured mid-flow,
  // before the user has reached the Vow moment where email is collected.
  const isPartial = typeof stage === 'string' && stage.startsWith('partial');
  if (!isPartial && !email) return res.status(400).json({ error: 'Email is required' });

  const formatTopicCoCreator = (entries) => {
    if (!entries || typeof entries !== 'object') return '';
    return Object.entries(entries)
      .filter(([, note]) => note && String(note).trim())
      .map(([topic, note]) => `${topic} — ${String(note).trim()}`)
      .join('; ');
  };

  const rowData = [
    timestamp || new Date().toISOString(),    // A
    email,                                    // B
    name || '',                               // C
    (roles || []).join(', '),                 // D
    comment || '',                            // E
    amount != null ? String(amount) : '',     // F (kept for future financial-contribution flow)
    (micro || []).join(', '),                 // G
    vow || '',                                // H
    dietary || '',                            // I
    accessibility || '',                      // J
    paymentIntentId || '',                    // K
    why || '',                                // L
    pathPosition || '',                       // M
    pathNote || '',                           // N
    (topicsYes || []).join(', '),             // O
    (topicsCurious || []).join(', '),         // P
    (topicsSkip || []).join(', '),            // Q
    formatTopicCoCreator(topicCoCreator),     // R
    topicOther || '',                         // S
    spectrums ? JSON.stringify(spectrums) : '', // T
    bravePrompt || '',                        // U
    bigQuestion || '',                        // V
    solsticeRsvp ? 'yes' : '',                // W
    orientation && Object.keys(orientation).length ? JSON.stringify(orientation) : '', // X
    stage || 'final',                         // Y
  ];

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
      let googleError = null;
      try { googleError = JSON.parse(errText); } catch (e) { googleError = { raw: errText.substring(0, 200) }; }
      return res.status(502).json({ error: 'auth_failed', stage: 'token_refresh', google: googleError });
    }

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('No access_token in response:', JSON.stringify(tokenData).substring(0, 200));
      return res.status(502).json({ error: 'auth_failed', stage: 'no_access_token' });
    }

    // Step 2: Write to sheet
    // Range widened to A:Y to accommodate the stage column (was A:X).
    // Keep the !-as-%21 and :-as-%3A encoding (regression fixed in 3bd26ea).
    const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Signups%21A%3AY:append?valueInputOption=RAW`;
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
