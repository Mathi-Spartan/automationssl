// POST /api/cancel — cancels a GoGetSSL subscription.
// Allowed: reseller who owns the order (own stock or assigned-to-customer).
// Customer-owned direct purchases cannot be cancelled by the customer themselves
// — they must contact the reseller, who then calls this.
// GoGetSSL V2 cancel: DELETE /v2/certificates/acme/{orderId} or /v2/certificates/ais/{itemId}
// After a successful cancel we mark the order status as 'cancelled' in Supabase.

const GG2 = 'https://my.gogetssl.com/api/v2'
const SB = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SRK = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const H = () => ({ 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}` })

function ggHeaders() {
  const code = (process.env.GOGETSSL_PARTNER_CODE || '133617').trim()
  const pass = (process.env.GOGETSSL_PASS || '').trim()
  return { Authorization: `GGS ${code}:${pass}`, 'Content-Type': 'application/json', Accept: 'application/json' }
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

    const pr = await (await fetch(`${SB()}/rest/v1/profiles?id=eq.${user.id}&select=account_type`, { headers: H() })).json()
    if (pr?.[0]?.account_type !== 'reseller')
      return res.status(403).json({ error: true, message: 'Only reseller accounts can cancel subscriptions.' })

    const { order_id } = req.body || {}
    if (!order_id) return res.status(400).json({ error: true, message: 'order_id is required.' })

    const ord = await (await fetch(
      `${SB()}/rest/v1/orders?id=eq.${encodeURIComponent(order_id)}&select=id,user_id,product_id,gogetssl_order_id,status,api_response,assigned_at`,
      { headers: H() }
    )).json()
    const order = ord?.[0]
    if (!order) return res.status(404).json({ error: true, message: 'Order not found.' })
    if (order.status === 'cancelled') return res.status(409).json({ error: true, message: 'This subscription is already cancelled.' })

    // only the owning reseller can cancel — not a sub-account customer
    if (order.user_id !== user.id) {
      // maybe it's one of their sub-accounts' purchases
      const op = await (await fetch(`${SB()}/rest/v1/profiles?id=eq.${order.user_id}&select=parent_reseller_id`, { headers: H() })).json()
      if (op?.[0]?.parent_reseller_id !== user.id)
        return res.status(403).json({ error: true, message: 'This subscription does not belong to you or your customers.' })
    }

    const isAcme = Number(order.product_id) === 300
    const vendorOrderId = order.gogetssl_order_id
    const itemId = order?.api_response?.items?.[0]?.id

    // CaaS: DELETE /v2/certificates/acme/{orderId}
    // AIS:  DELETE /v2/certificates/ais/{itemId}
    let cancelUrl
    if (isAcme) {
      cancelUrl = `${GG2}/certificates/acme/${encodeURIComponent(vendorOrderId)}`
    } else {
      if (!itemId) return res.status(502).json({ error: true, message: 'Cannot locate the vendor item ID — please re-sync first.' })
      cancelUrl = `${GG2}/certificates/ais/${encodeURIComponent(itemId)}`
    }

    const cancelRes = await fetch(cancelUrl, { method: 'DELETE', headers: ggHeaders() })
    // GoGetSSL returns 204 No Content on success; some endpoints return 200 with body
    if (!cancelRes.ok && cancelRes.status !== 204) {
      const body = await cancelRes.json().catch(() => ({}))
      console.error('Vendor cancel rejected:', cancelRes.status, JSON.stringify(body))
      return res.status(502).json({ error: true, message: 'The certificate authority rejected the cancellation.', detail: body?.message || body })
    }

    // Mark cancelled in Supabase
    await fetch(`${SB()}/rest/v1/orders?id=eq.${encodeURIComponent(order_id)}`, {
      method: 'PATCH',
      headers: { ...H(), Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'cancelled', last_synced_at: new Date().toISOString() }),
    })

    return res.status(200).json({ ok: true, cancelled: true, order_id, vendor_order_id: vendorOrderId })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Cancellation failed.', detail: String(err.message || err) })
  }
}
