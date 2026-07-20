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

// Quota is a yes/no gate and knows nothing about price. Reserving happens
// BEFORE the CA call so two concurrent orders cannot both take the last unit —
// the decision is made inside Postgres under row locks, not here.
async function rpc(fn, body) {
  const r = await fetch(`${SB()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}` },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${fn} failed: ${r.status} ${await r.text().catch(() => '')}`)
  const rows = await r.json()
  return Array.isArray(rows) ? rows[0] : rows
}

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
      const custRes = await fetch(`${SB()}/rest/v1/profiles?id=eq.${encodeURIComponent(for_customer_id)}&select=id,parent_reseller_id,full_name,account_type`, {
        headers: { apikey: SRK(), Authorization: `Bearer ${SRK()}` },
      })
      const cust = await custRes.json()
      // Subtree, not direct children. A master buying for a sub-reseller's
      // customer reaches them THROUGH the sub-reseller, so parent === caller is
      // false and the order was refused. descendants_of is the same function
      // the RLS read policy uses, so API permission and row visibility cannot
      // drift apart.
      let inTree = cust?.[0]?.parent_reseller_id === user.id
      if (cust?.[0] && !inTree) {
        const rows = await rpc('descendants_of', { root: user.id }).catch(() => null)
        inTree = Array.isArray(rows)
          && rows.some((x) => (typeof x === 'string' ? x : x?.descendants_of) === for_customer_id)
      }
      if (!cust?.[0] || !inTree)
        return res.status(403).json({ error: true, message: 'That customer does not belong to your account.' })
      // Certificates go to retail customers only. A sub-reseller buys for their
      // own customers; a plan held by a reseller has no owner to install it.
      // The UI already filters them out, but the API must not rely on that.
      if (cust[0].account_type === 'reseller')
        return res.status(400).json({ error: true, message: 'Plans cannot be bought for a reseller account. Choose one of their customers, or buy to your inventory.' })
      targetUserId = for_customer_id
      assignedBy = user.id
      assignedAt = new Date().toISOString()
    }

    // Price the order BEFORE placing it at the CA. resolve_price is the single
    // source of truth — the dashboard previews through the same function, so a
    // quote can never disagree with the charge. A missing slab is a hard stop:
    // an order silently recorded at zero is worse than a refusal, because it is
    // only discovered at month end.
    let priceRow = null
    try {
      const prRes = await fetch(
        `${SB()}/rest/v1/rpc/resolve_price`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}` },
          body: JSON.stringify({ buyer: targetUserId, prod: Number(product_id) }) },
      )
      priceRow = (await prRes.json())?.[0] || null
    } catch (_e) { priceRow = null }

    if (!priceRow || priceRow.bill_price == null) {
      return res.status(400).json({
        error: true,
        message: priceRow?.reason
          ? `Cannot price this order: ${priceRow.reason}.`
          : 'Cannot price this order — no price is configured for this account.',
      })
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

    // -------- reserve inventory before spending money --------
    // Every level of the chain is charged: the buyer, their reseller, and the
    // master. Refused here costs nothing; refused after the CA call would mean
    // a paid certificate we cannot record.
    let reserved = false
    try {
      const q = await rpc('reserve_quota', { buyer: targetUserId, prod: Number(product_id), qty: 1, allow_over: false })
      if (!q?.ok) {
        return res.status(409).json({
          error: true,
          message: q?.blocked_name
            ? `${q.blocked_name} has no inventory left for this plan (${q.blocked_used} of ${q.blocked_cap} used). Ask your provider to raise the limit.`
            : 'No inventory left for this plan. Ask your provider to raise the limit.',
          quota: q || null,
        })
      }
      reserved = true
    } catch (e) {
      // A quota system that fails open would silently defeat the limits, so
      // this refuses rather than guessing.
      console.error('reserve_quota failed:', String(e))
      return res.status(503).json({ error: true, message: 'Could not check inventory. Please try again.' })
    }

    let order, orderRes
    try {
      orderRes = await fetch(endpoint, {
        method: 'POST',
        headers: ggHeaders(),
        body: JSON.stringify(payload),
      })
      order = await orderRes.json()
    } catch (e) {
      await rpc('release_quota', { buyer: targetUserId, prod: Number(product_id), qty: 1 }).catch(() => {})
      console.error('CA call threw, quota released:', String(e))
      return res.status(502).json({ error: true, message: 'Could not reach the certificate authority. Nothing was ordered.' })
    }

    const orderId = order?.order?.id
    if (!orderRes.ok || !orderId) {
      // Nothing was bought, so give the unit back.
      await rpc('release_quota', { buyer: targetUserId, prod: Number(product_id), qty: 1 }).catch((e) => {
        console.error('release_quota after CA rejection failed:', String(e))
      })
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
    // The reservation is deliberately NOT released when this fails. A real
    // order exists at the CA, so the unit really was spent; handing it back
    // would let a failing insert be used to order past the limit. The ledger
    // can therefore over-count relative to the orders table, which is the safe
    // direction and is visible on the Inventory page.
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
          bill_price: priceRow.bill_price,
          sale_price: priceRow.sale_price ?? priceRow.bill_price,
          price_currency: 'USD',
          priced_at: new Date().toISOString(),
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
