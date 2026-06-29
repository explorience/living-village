export default function handler(req, res) {
  return res.status(200).json({
    hasClientId: !!process.env.GCLIENT_ID,
    hasSecret: !!process.env.GCLIENT_SECRET,
    hasRefresh: !!process.env.GREFRESH_TOKEN,
    clientIdStart: process.env.GCLIENT_ID ? process.env.GCLIENT_ID.substring(0, 15) : 'MISSING',
    nodeEnv: process.env.NODE_ENV
  });
}
