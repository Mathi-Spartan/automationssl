// POST /api/order — places a live order via the GoGetSSL V2 API and records it
// in Supabase. Credentials come exclusively from environment variables:
//   GOGETSSL_PARTNER_CODE, GOGETSSL_PASS, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Automation products use the V2 API (V1 add_ssl_order does not support them):
//   - product 300 (Sectigo ACME CaaS, category "caas"): POST /v2/certificates/acme
//     with { product: {id}, domains } — customer receives EAB credentials.
//   - products 400-403 (Plan + Automate, category "ais"): POST /v2/certificates/ais
//     with { product: {id}, contacts } — customer receives an AutoInstall SSO link;
//     domains are configured later through the automation agent.
// No CSR is involved anywhere in this workflow.

const GG2 = 'https://my.gogetssl.com/api/v2'

const KNOWN_PRODUCTS = {
  300: { name: 'Sectigo ACME Certificate-as-a-Service', category: 'acme' },
  400: { name: 'RapidSSL Plan + Automate', category: 'ais' },
  401: { name: 'RapidSSL Wildcard Plan + Automate', category: 'ais' },
  402: { name: 'GeoTrust DV Plan + Automate', category: 'ais' },
  403: { name: 'GeoTrust DV Wildcard Plan + Automate', category: 'ais' },
}

function ggHeaders() {
  const code = (process.env.GOGETSSL_PARTNER_CODE || '133617').trim()
  const pass = (process.env.GOGETSSL_PASS || '').trim()
  return {
    Authorization: `GGS ${code}:${pass}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

const SB = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SRK = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Resolve the signed-in Supabase user from the Authorization: Bearer header.
async function resolveUser(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  try {
    const r = await fetch(`${SB()}/auth/v1/user`, {
      headers: { apikey: SRK(), Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Method not allowed' })

  try {
    const user = await resolveUser(req)
    if (!user?.id) return res.status(401).json({ error: true, message: 'Please sign in to place an order.' })

    const { product_id, period, domain, email, firstname, lastname, phone, server_id, for_customer_id } = req.body || {}

    // -------- reseller ordering on behalf of a customer --------
    // If for_customer_id is supplied, verify the caller is a reseller and the
    // target customer belongs to them. The order will be attributed directly to
    // the customer with assigned_by stamped so provenance is clear.
    let targetUserId = user.id
    let assignedBy = null
    let assignedAt = null
    if (for_customer_id) {
      // Caller must be a reseller
      const prRes = await fetch(`${SB()}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=account_type`, {
        headers: { apikey: SRK(), Authorization: `Bearer ${SRK()}` },
      })
      const pr = await prRes.json()
      if (pr?.[0]?.account_type !== 'reseller')
        return res.status(403).json({ error: true, message: 'Only reseller accounts can order on behalf of a customer.' })
      // Target must be a sub-account of this reseller
      const custRes = await fetch(`${SB()}/rest/v1/profiles?id=eq.${encodeURIComponent(for_customer_id)}&select=id,parent_reseller_id,full_name`, {
        headers: { apikey: SRK(), Authorization: `Bearer ${SRK()}` },
      })
      const cust = await custRes.json()
      if (!cust?.[0] || cust[0].parent_reseller_id !== user.id)
        return res.status(403).json({ error: true, message: 'That customer does not belong to your account.' })
      targetUserId = for_customer_id
      assignedBy = user.id
      assignedAt = new Date().toISOString()
    }

    // If a server tag was chosen, it must belong to the buyer.
    let serverId = null
    if (server_id) {
      const sv = await fetch(`${SB()}/rest/v1/servers?id=eq.${encodeURIComponent(server_id)}&select=id,owner_id`, {
        headers: { apikey: SRK(), Authorization: `Bearer ${SRK()}` },
      })
      const svRows = await sv.json()
      if (svRows?.[0]?.owner_id === user.id) serverId = svRows[0].id
    }
    const product = KNOWN_PRODUCTS[product_id]

    // -------- validation --------
    if (!product) return res.status(400).json({ error: true, message: 'Unknown plan selected.' })
    if (!domain || !/^[*a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain))
      return res.status(400).json({ error: true, message: 'Please enter a valid domain name.' })
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ error: true, message: 'Please enter a valid email address.' })
    if (!firstname || !lastname) return res.status(400).json({ error: true, message: 'First and last name are required.' })
    if (!phone) return res.status(400).json({ error: true, message: 'Phone number is required.' })
    const months = Number(period) || 12

    // -------- create the subscription via V2 --------
    let endpoint, payload
    if (product.category === 'acme') {
      endpoint = `${GG2}/certificates/acme`
      // The V2 API requires domains as an ARRAY of strings (verified against the
      // official GoGetSSL WHMCS module's normalizeDomains) — a bare string is
      // rejected with the generic GEX-3 error.
      const callbackBase = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://automationssl.vercel.app'
      payload = { product: { id: Number(product_id) }, domains: [domain.replace(/^\*\./, '')], callback_url: `${callbackBase}/api/cron-sync` }
    } else {
      endpoint = `${GG2}/certificates/ais`
      payload = {
        product: { id: Number(product_id) },
        contacts: { primary: { email }, technical: { email } },
      }
    }

    const orderRes = await fetch(endpoint, {
      method: 'POST',
      headers: ggHeaders(),
      body: JSON.stringify(payload),
    })
    const order = await orderRes.json()

    const orderId = order?.order?.id
    if (!orderRes.ok || !orderId) {
      console.error('GoGetSSL V2 order rejected:', JSON.stringify(order))
      return res.status(502).json({
        error: true,
        message: 'The certificate authority rejected the order.',
        detail: order?.message || order,
      })
    }

    // -------- extract customer deliverables from the CA response --------
    // These are shown once on the success screen and again via /api/status.
    const item = order?.items?.[0] || {}
    const itemId = item.id || null

    let autoinstall = null
    if (item.autoinstall) {
      autoinstall = {
        setup_link: item.autoinstall.login_sso_link || item.autoinstall.manage_sso_link || null,
        status: item.autoinstall.status || null,
      }
    }

    let acme = null
    if (product.category === 'acme') {
      const found = {}
      const scan = (obj) => {
        for (const [k, v] of Object.entries(obj || {})) {
          if (v && typeof v === 'object' && !Array.isArray(v)) scan(v)
          else if (/eab|server_url|acme_account|directory/i.test(k) && v) found[k] = v
        }
      }
      scan(order)
      if (Object.keys(found).length) acme = found
    }

    // -------- record in Supabase (best-effort; order already exists at the CA) --------
    let db_ok = true
    try {
      const sbRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          gogetssl_order_id: orderId,
          product_id,
          product_name: product.name,
          period: months,
          domain,
          email,
          customer_name: `${firstname} ${lastname}`,
          phone,
          status: order?.order?.status || 'pending',
          api_response: order,
          user_id: targetUserId,
          assigned_by: assignedBy,
          assigned_at: assignedAt,
          server_id: serverId,
        }),
      })
      db_ok = sbRes.ok
      if (!sbRes.ok) {
        // Never fail the customer for this, but make the cause visible in logs.
        console.error('Supabase insert rejected:', sbRes.status, await sbRes.text().catch(() => ''))
      }
    } catch (e) {
      db_ok = false
      console.error('Supabase insert failed:', String(e))
    }

    return res.status(200).json({ order_id: orderId, item_id: itemId, db_ok, autoinstall, acme })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Order failed.', detail: String(err.message || err) })
  }
}
