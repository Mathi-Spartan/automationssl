// POST /api/assign — permanently assigns a reseller-owned subscription to one
// of the reseller's own customer accounts. Body: { order_id (uuid), customer_id }.
//
// Server-side rules, checked in order (each failure returns its own reason):
//   1. caller is signed in                     -> 401
//   2. caller is a reseller                    -> 403
//   3. the order belongs to the caller         -> 403
//   4. the order was never assigned before     -> 409
//   5. the target is one of the caller's subs  -> 400
// The database additionally enforces immutability via the
// orders_assignment_lock trigger, so reassignment is impossible at any layer.

const SB = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SRK = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const H = () => ({ 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}` })

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

    const pr = await (await fetch(`${SB()}/rest/v1/profiles?id=eq.${user.id}&select=account_type`, { headers: H() })).json()
    if (pr?.[0]?.account_type !== 'reseller')
      return res.status(403).json({ error: true, message: 'Only reseller accounts can assign subscriptions.' })

    const { order_id, customer_id } = req.body || {}
    if (!order_id || !customer_id)
      return res.status(400).json({ error: true, message: 'order_id and customer_id are required.' })

    const ord = await (await fetch(
      `${SB()}/rest/v1/orders?id=eq.${encodeURIComponent(order_id)}&select=id,user_id,assigned_at,product_name,gogetssl_order_id`,
      { headers: H() }
    )).json()
    const order = ord?.[0]
    if (!order) return res.status(404).json({ error: true, message: 'Order not found.' })
    if (order.user_id !== user.id)
      return res.status(403).json({ error: true, message: 'You can only assign subscriptions you own.' })
    if (order.assigned_at)
      return res.status(409).json({ error: true, message: 'This subscription is permanently assigned and cannot be reassigned.' })

    const tgt = await (await fetch(
      `${SB()}/rest/v1/profiles?id=eq.${encodeURIComponent(customer_id)}&select=id,parent_reseller_id,full_name`,
      { headers: H() }
    )).json()
    const target = tgt?.[0]
    if (!target || target.parent_reseller_id !== user.id)
      return res.status(400).json({ error: true, message: 'The target must be one of your own customer accounts.' })

    // Assign: move ownership, stamp provenance, clear the reseller's server tag
    // (the customer will tag it to one of their own servers).
    const up = await fetch(`${SB()}/rest/v1/orders?id=eq.${encodeURIComponent(order_id)}&assigned_at=is.null`, {
      method: 'PATCH',
      headers: { ...H(), Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: target.id,
        assigned_by: user.id,
        assigned_at: new Date().toISOString(),
        server_id: null,
      }),
    })
    const upRows = await up.json().catch(() => [])
    if (!up.ok || !Array.isArray(upRows) || upRows.length === 0) {
      console.error('Assignment rejected:', up.status, JSON.stringify(upRows))
      return res.status(409).json({ error: true, message: 'Assignment failed — the subscription may have just been assigned.' })
    }

    return res.status(200).json({
      ok: true,
      order_id,
      gogetssl_order_id: order.gogetssl_order_id,
      product_name: order.product_name,
      assigned_to: target.full_name || target.id,
    })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Assignment failed.', detail: String(err.message || err) })
  }
}
