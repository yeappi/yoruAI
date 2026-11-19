// Public configuration only. Never return GEMINI_API_KEY.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return res.status(503).json({ error: 'Supabase is not configured' });
  return res.status(200).json({ supabaseUrl: url, supabaseKey: publishableKey });
};
