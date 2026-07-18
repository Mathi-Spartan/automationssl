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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Method not allowed' })

  try {
    const { product_id, period, domain, email, firstname, lastname, phone } = req.body || {}
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
      payload = { product: { id: Number(product_id) }, domains: domain.replace(/^\*\./, '') }
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
        }),
      })
      db_ok = sbRes.ok
    } catch {
      db_ok = false
    }

    return res.status(200).json({ order_id: orderId, db_ok })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Order failed.', detail: String(err.message || err) })
  }
}
