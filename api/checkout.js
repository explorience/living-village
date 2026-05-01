// Stripe PaymentIntent creator for the /join/ flow.
// Returns { clientSecret, publishableKey, paymentIntentId } so the client
// can mount the PaymentElement and confirm in-place (no redirect to Stripe).
//
// Required env vars (set in Vercel):
//   STRIPE_SECRET_KEY       — sk_test_... or sk_live_...
//   STRIPE_PUBLISHABLE_KEY  — pk_test_... or pk_live_...
//
// Fail-loud pattern matches signup.js: 502 on upstream errors, 500 on
// unexpected, 400 on bad input. Never silently succeed.

const MIN_AMOUNT = 22;
const MAX_AMOUNT = 222;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { amount, email } = req.body || {};
  const intAmount = Number.parseInt(amount, 10);
  if (!Number.isFinite(intAmount) || intAmount < MIN_AMOUNT || intAmount > MAX_AMOUNT) {
    return res.status(400).json({ error: 'invalid_amount', min: MIN_AMOUNT, max: MAX_AMOUNT });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) {
    console.error('Stripe env vars missing', { hasSecret: !!secretKey, hasPublishable: !!publishableKey });
    return res.status(502).json({ error: 'stripe_not_configured' });
  }

  try {
    const params = new URLSearchParams({
      amount: String(intAmount * 100), // Stripe uses cents
      currency: 'cad',
      'automatic_payment_methods[enabled]': 'true',
      description: 'The Living Village · Reciprocity Pool contribution',
      'metadata[source]': 'living-village-join-flow',
      'metadata[event]': 'living-village-2026-08',
    });
    if (email) params.append('receipt_email', email);

    const piRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!piRes.ok) {
      const errText = await piRes.text();
      console.error('Stripe PaymentIntent failed:', piRes.status, errText.substring(0, 300));
      return res.status(502).json({ error: 'stripe_failed', status: piRes.status });
    }

    const pi = await piRes.json();
    if (!pi.client_secret || !pi.id) {
      console.error('Stripe response missing fields:', JSON.stringify(pi).substring(0, 200));
      return res.status(502).json({ error: 'stripe_bad_response' });
    }

    return res.status(200).json({
      clientSecret: pi.client_secret,
      publishableKey,
      paymentIntentId: pi.id,
    });
  } catch (err) {
    console.error('Checkout error:', err.message, err.stack?.substring(0, 200));
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
}
