// Signup API - stores to a Google Sheet or sends email notification
// For now, logs to console and stores locally

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name, roles, comment, timestamp } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Log the signup
  console.log('New signup:', JSON.stringify({ email, name, roles, comment, timestamp }));

  // TODO: Connect to Google Sheets, email notification, or database
  // For now, just acknowledge
  return res.status(200).json({ success: true, message: 'Welcome to the village.' });
}
