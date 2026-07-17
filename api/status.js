// GET /api/status?order_id=..&email=.. — verifies the email matches the order in
// Supabase, then returns curated live status from GoGetSSL, including any
// ACME/enrollment credentials the CA has attached to the order.

const GG = 'https://my.gogetssl.com/api'

async function ggAuth() {
  const res = await fetch(`${GG}/auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user: (process.env.GOGETSSL_USER || '').trim(), pass: (process.env.GOGETSSL_PASS || '').trim() }),
  })
  const data = await res.json()
  if (!data.key) throw new Error('Certificate authority authentication failed')
  return data.key
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Method not allowed' })

  try {
    const { order_id, email } = req.query || {}
    if (!order_id || !email) return res.status(400).json({ error: true, message: 'Order ID and email are required.' })

    // -------- ownership check against our own records --------
    const q = new URLSearchParams({
      gogetssl_order_id: `eq.${order_id}`,
      email: `eq.${String(email).toLowerCase()}`,
      select: 'gogetssl_order_id,product_name,domain,period',
      limit: '1',
    })
    const sbRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?${q}`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    })
    const rows = await sbRes.json()
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(404).json({ error: true, message: 'No order found for that ID and email combination.' })
    const record = rows[0]

    // -------- live status from GoGetSSL --------
    const key = await ggAuth()
    const stRes = await fetch(`${GG}/orders/status/${encodeURIComponent(order_id)}?auth_key=${key}`)
    const st = await stRes.json()

    // Collect ACME / enrollment fields regardless of exact naming
    const acme = {}
    for (const [k, v] of Object.entries(st)) {
      if (/acme|eab|directory|hmac|enrollment|registration/i.test(k) && v) acme[k] = v
    }

    return res.status(200).json({
      status: st.status || 'submitted',
      product_name: record.product_name,
      domain: record.domain,
      valid_from: st.valid_from || null,
      valid_till: st.valid_till || null,
      acme: Object.keys(acme).length ? acme : null,
    })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Status lookup failed.', detail: String(err.message || err) })
  }
}
