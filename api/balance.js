// GET /api/balance — returns the reseller's live GoGetSSL account balance.
// Reseller-only. Calls GoGetSSL V1 GET /api/account/balance
// Cached for 60s so a page refresh doesn't hammer the vendor API.

const SB = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SRK = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const H = () => ({ 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}` })

function ggHeaders() {
  const code = (process.env.GOGETSSL_PARTNER_CODE || '133617').trim()
  const pass = (process.env.GOGETSSL_PASS || '').trim()
  return { Authorization: `GGS ${code}:${pass}`, Accept: 'application/json' }
}

async function resolveUser(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  try {
    const r = await fetch(`${SB()}/auth/v1/user`, { headers: { apikey: SRK(), Authorization: `Bearer ${token}` } })
    return r.ok ? await r.json() : null
  } catch { return null }
}

let cache = null // { balance, currency, ts }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Method not allowed' })

  try {
    const user = await resolveUser(req)
    if (!user?.id) return res.status(401).json({ error: true, message: 'Please sign in.' })

    const pr = await (await fetch(`${SB()}/rest/v1/profiles?id=eq.${user.id}&select=account_type`, { headers: H() })).json()
    if (pr?.[0]?.account_type !== 'reseller')
      return res.status(403).json({ error: true, message: 'Balance is available to reseller accounts only.' })

    if (cache && Date.now() - cache.ts < 60_000)
      return res.status(200).json({ ok: true, cached: true, balance: cache.balance, currency: cache.currency })

    const r = await fetch('https://my.gogetssl.com/api/account/balance/', { headers: ggHeaders() })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      return res.status(502).json({ error: true, message: 'Could not fetch balance from GoGetSSL.', detail: body?.message || body })
    }
    const data = await r.json()
    // GoGetSSL returns { balance: "123.45", currency: "USD" } or similar
    const balance = data?.balance ?? data?.amount ?? null
    const currency = data?.currency || 'USD'
    cache = { balance, currency, ts: Date.now() }

    return res.status(200).json({ ok: true, cached: false, balance, currency, raw: data })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Balance fetch failed.', detail: String(err.message || err) })
  }
}
