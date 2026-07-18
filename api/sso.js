// POST /api/sso — returns a fresh AutoInstall SSO link for an AIS subscription.
// The link returned at order time expires; this endpoint regenerates it on demand.
// GoGetSSL V2: GET /v2/certificates/ais/{itemId}/sso
// Allowed: order owner or their reseller.

const GG2 = 'https://my.gogetssl.com/api/v2'
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Method not allowed' })

  try {
    const user = await resolveUser(req)
    if (!user?.id) return res.status(401).json({ error: true, message: 'Please sign in.' })

    const { order_id } = req.body || {}
    if (!order_id) return res.status(400).json({ error: true, message: 'order_id is required.' })

    const ord = await (await fetch(
      `${SB()}/rest/v1/orders?id=eq.${encodeURIComponent(order_id)}&select=id,user_id,product_id,api_response`,
      { headers: H() }
    )).json()
    const order = ord?.[0]
    if (!order) return res.status(404).json({ error: true, message: 'Order not found.' })
    if (Number(order.product_id) === 300)
      return res.status(400).json({ error: true, message: 'SSO links apply to AutoInstall (AIS) products only, not CaaS.' })

    let allowed = order.user_id === user.id
    if (!allowed && order.user_id) {
      const op = await (await fetch(`${SB()}/rest/v1/profiles?id=eq.${order.user_id}&select=parent_reseller_id`, { headers: H() })).json()
      allowed = op?.[0]?.parent_reseller_id === user.id
    }
    if (!allowed) return res.status(403).json({ error: true, message: 'Not your subscription.' })

    const itemId = order?.api_response?.items?.[0]?.id
    if (!itemId) return res.status(502).json({ error: true, message: 'No vendor item ID found — please re-sync first.' })

    const ssoRes = await fetch(`${GG2}/certificates/ais/${encodeURIComponent(itemId)}/sso`, { headers: ggHeaders() })
    if (!ssoRes.ok) {
      const body = await ssoRes.json().catch(() => ({}))
      console.error('SSO link refresh failed:', ssoRes.status, JSON.stringify(body))
      return res.status(502).json({ error: true, message: 'Could not retrieve a fresh install link from the CA.', detail: body?.message || body })
    }
    const data = await ssoRes.json()
    const link = data?.sso_link || data?.login_sso_link || data?.manage_sso_link || data?.url || null
    if (!link) return res.status(502).json({ error: true, message: 'CA returned an empty SSO response.', raw: data })

    return res.status(200).json({ ok: true, sso_link: link })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'SSO refresh failed.', detail: String(err.message || err) })
  }
}
