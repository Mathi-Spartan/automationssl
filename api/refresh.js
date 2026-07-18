// POST /api/refresh — re-fetches a subscription's live state from GoGetSSL and
// updates the stored record. Body: { order_id (uuid) }.
// Allowed callers: the order's owner, or the reseller the owner belongs to.
// Throttled: if synced within the last 120s, returns the stored record as-is.

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
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Method not allowed' })

  try {
    const user = await resolveUser(req)
    if (!user?.id) return res.status(401).json({ error: true, message: 'Please sign in.' })

    const { order_id } = req.body || {}
    if (!order_id) return res.status(400).json({ error: true, message: 'order_id is required.' })

    const ord = await (await fetch(
      `${SB()}/rest/v1/orders?id=eq.${encodeURIComponent(order_id)}&select=id,user_id,product_id,status,api_response,last_synced_at`,
      { headers: H() }
    )).json()
    const order = ord?.[0]
    if (!order) return res.status(404).json({ error: true, message: 'Order not found.' })

    // owner, or the owner's reseller
    let allowed = order.user_id === user.id
    if (!allowed && order.user_id) {
      const op = await (await fetch(
        `${SB()}/rest/v1/profiles?id=eq.${order.user_id}&select=parent_reseller_id`,
        { headers: H() }
      )).json()
      allowed = op?.[0]?.parent_reseller_id === user.id
    }
    if (!allowed) return res.status(403).json({ error: true, message: 'Not your subscription.' })

    // throttle
    if (order.last_synced_at && Date.now() - new Date(order.last_synced_at).getTime() < 120_000) {
      return res.status(200).json({ ok: true, refreshed: false, status: order.status, api_response: order.api_response })
    }

    const category = Number(order.product_id) === 300 ? 'acme' : 'ais'
    const itemId = order?.api_response?.items?.[0]?.id
    if (!itemId) return res.status(200).json({ ok: true, refreshed: false, status: order.status, api_response: order.api_response })

    const stRes = await fetch(`${GG2}/certificates/${category}/${encodeURIComponent(itemId)}`, { headers: ggHeaders() })
    if (!stRes.ok) {
      console.error('Vendor refresh failed:', stRes.status)
      return res.status(200).json({ ok: true, refreshed: false, status: order.status, api_response: order.api_response })
    }
    const fresh = await stRes.json()

    const patch = {
      api_response: fresh,
      status: fresh?.order?.status || order.status,
      last_synced_at: new Date().toISOString(),
    }
    const up = await fetch(`${SB()}/rest/v1/orders?id=eq.${encodeURIComponent(order_id)}`, {
      method: 'PATCH',
      headers: { ...H(), Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    })
    if (!up.ok) console.error('Refresh store failed:', up.status, await up.text().catch(() => ''))

    return res.status(200).json({ ok: true, refreshed: true, status: patch.status, api_response: fresh })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Refresh failed.', detail: String(err.message || err) })
  }
}
