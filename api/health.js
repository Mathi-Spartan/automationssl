// GET /api/health — non-destructive diagnostics. Reports which env vars are
// present (booleans only, never values) and whether GoGetSSL auth succeeds.

export default async function handler(req, res) {
  const env = {
    GOGETSSL_USER: Boolean(process.env.GOGETSSL_USER),
    GOGETSSL_PASS: Boolean(process.env.GOGETSSL_PASS),
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  }

  let ca_auth = 'skipped'
  let ca_response = null
  if (env.GOGETSSL_USER && env.GOGETSSL_PASS) {
    try {
      const r = await fetch('https://my.gogetssl.com/api/auth/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          user: process.env.GOGETSSL_USER.trim(),
          pass: process.env.GOGETSSL_PASS.trim(),
        }),
      })
      const data = await r.json()
      ca_auth = data.key ? 'ok' : 'rejected'
      if (!data.key) ca_response = data
    } catch (e) {
      ca_auth = 'network_error'
      ca_response = String(e.message || e)
    }
  }

  return res.status(200).json({ env, ca_auth, ca_response })
}
