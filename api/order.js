// POST /api/order — places a live order with GoGetSSL and records it in Supabase.
// Credentials come exclusively from environment variables (never bundled client-side):
//   GOGETSSL_USER, GOGETSSL_PASS, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import forge from 'node-forge'

const GG = 'https://my.gogetssl.com/api'

// Products whose placeholder CSR must carry a wildcard common name
const WILDCARD_CN = new Set([300, 401, 403])

// The order API requires a CSR even for automation/ACME plans. It is a pure
// formality: the customer's ACME client generates its own keys later, so we
// create a throwaway key+CSR in memory and discard the key immediately.
function placeholderCsr(commonName) {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const csr = forge.pki.createCertificationRequest()
  csr.publicKey = keys.publicKey
  csr.setSubject([{ name: 'commonName', value: commonName }])
  csr.sign(keys.privateKey, forge.md.sha256.create())
  return forge.pki.certificationRequestToPem(csr)
}

const KNOWN_PRODUCTS = {
  300: 'Sectigo ACME Certificate-as-a-Service',
  400: 'RapidSSL Plan + Automate',
  401: 'RapidSSL Wildcard Plan + Automate',
  402: 'GeoTrust DV Plan + Automate',
  403: 'GeoTrust DV Wildcard Plan + Automate',
}

async function ggAuth() {
  const res = await fetch(`${GG}/auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user: (process.env.GOGETSSL_USER || '').trim(), pass: (process.env.GOGETSSL_PASS || '').trim() }),
  })
  const data = await res.json()
  if (!data.key) {
    console.error('GoGetSSL auth rejected:', JSON.stringify(data))
    throw new Error('Certificate authority authentication failed: ' + (data.description || data.message || JSON.stringify(data)))
  }
  return data.key
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Method not allowed' })

  try {
    const { product_id, period, domain, email, firstname, lastname, phone, csr } = req.body || {}

    // -------- validation --------
    if (!KNOWN_PRODUCTS[product_id]) return res.status(400).json({ error: true, message: 'Unknown plan selected.' })
    if (!domain || !/^[*a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain))
      return res.status(400).json({ error: true, message: 'Please enter a valid domain name.' })
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ error: true, message: 'Please enter a valid email address.' })
    if (!firstname || !lastname) return res.status(400).json({ error: true, message: 'First and last name are required.' })
    if (!phone) return res.status(400).json({ error: true, message: 'Phone number is required.' })
    const months = Number(period) || 12

    // -------- place order with GoGetSSL --------
    const base = domain.replace(/^\*\./, '')
    const cn = WILDCARD_CN.has(Number(product_id)) ? `*.${base.replace(/^www\./, '')}` : base
    const finalCsr = csr || placeholderCsr(cn)

    const key = await ggAuth()
    const params = new URLSearchParams({
      product_id: String(product_id),
      period: String(months),
      server_count: '-1',
      webserver_type: '-1',
      admin_firstname: firstname,
      admin_lastname: lastname,
      admin_phone: phone,
      admin_title: 'Mr.',
      admin_email: email,
      tech_firstname: firstname,
      tech_lastname: lastname,
      tech_phone: phone,
      tech_title: 'Mr.',
      tech_email: email,
    })
    params.set('csr', finalCsr)

    const orderRes = await fetch(`${GG}/orders/add_ssl_order/?auth_key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })
    const order = await orderRes.json()

    if (order.error || !order.order_id) {
      return res.status(502).json({
        error: true,
        message: 'The certificate authority rejected the order.',
        detail: order.description || order.message || order,
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
          gogetssl_order_id: order.order_id,
          product_id,
          product_name: KNOWN_PRODUCTS[product_id],
          period: months,
          domain,
          email,
          customer_name: `${firstname} ${lastname}`,
          phone,
          status: 'submitted',
          api_response: order,
        }),
      })
      db_ok = sbRes.ok
    } catch {
      db_ok = false
    }

    return res.status(200).json({ order_id: order.order_id, db_ok })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Order failed.', detail: String(err.message || err) })
  }
}
