// POST /api/domains — adds a domain to a Sectigo CaaS subscription (product 300).
// RESELLER-ONLY: adding domains carries pro-rated charges at the CA, so only the
// billing owner may do it. Access is granted when the caller is a reseller AND
// the order belongs to them OR to one of their sub-accounts — covering all three
// purchase paths (reseller-kept, reseller-assigned, customer-purchased).
//
// Vendor call (verified against the official WHMCS module + live GETs):
//   POST /v2/certificates/acme/{VENDOR_ORDER_ID}/domains  body: ["domain.tld"]
// After a successful add we immediately re-GET /v2/certificates/caas/{item_id}
// and store the fresh payload, so the dashboard shows the up-to-date domains
// and ACME credentials straight away.

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
      return res.status(403).json({ error: true, message: 'Domains are added by your provider — this action is reserved for reseller accounts because it involves pro-rated billing.' })

    const { order_id, domain } = req.body || {}
    const clean = String(domain || '').trim().toLowerCase()
    if (!order_id || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean))
      return res.status(400).json({ error: true, message: 'A valid domain name is required.' })

    const ord = await (await fetch(
      `${SB()}/rest/v1/orders?id=eq.${encodeURIComponent(order_id)}&select=id,user_id,product_id,gogetssl_order_id,api_response`,
      { headers: H() }
    )).json()
    const order = ord?.[0]
    if (!order) return res.status(404).json({ error: true, message: 'Order not found.' })
    if (Number(order.product_id) !== 300)
      return res.status(400).json({ error: true, message: 'Multi-domain management applies to Sectigo ACME CaaS subscriptions only.' })

    // reseller owns it, or it belongs to one of the reseller's sub-accounts
    let allowed = order.user_id === user.id
    if (!allowed && order.user_id) {
      const op = await (await fetch(`${SB()}/rest/v1/profiles?id=eq.${order.user_id}&select=parent_reseller_id`, { headers: H() })).json()
      allowed = op?.[0]?.parent_reseller_id === user.id
    }
    if (!allowed) return res.status(403).json({ error: true, message: 'This subscription does not belong to you or your customers.' })

    // duplicate guard against the last-synced vendor state
    const existing = (order?.api_response?.items?.[0]?.domains || [])
      .map((d) => (typeof d === 'string' ? d : d?.name || '').toLowerCase())
    if (existing.includes(clean))
      return res.status(409).json({ error: true, message: `${clean} is already on this subscription.` })

    // ---- vendor add (pro-rated billing happens on the CA side) ----
    let addRes = await fetch(`${GG2}/certificates/acme/${order.gogetssl_order_id}/domains`, {
      method: 'POST',
      headers: ggHeaders(),
      body: JSON.stringify([clean]),
    })
    let addBody = await addRes.json().catch(() => ({}))
    if (!addRes.ok) {
      // fallback body shape, in case this account's API build expects an object
      const retry = await fetch(`${GG2}/certificates/acme/${order.gogetssl_order_id}/domains`, {
        method: 'POST',
        headers: ggHeaders(),
        body: JSON.stringify({ domains: [clean] }),
      })
      const retryBody = await retry.json().catch(() => ({}))
      if (!retry.ok) {
        console.error('CaaS domain add rejected:', addRes.status, JSON.stringify(addBody), '| retry:', retry.status, JSON.stringify(retryBody))
        return res.status(502).json({
          error: true,
          message: 'The certificate authority rejected the domain addition.',
          detail: retryBody?.message || addBody?.message || retryBody || addBody,
        })
      }
      addBody = retryBody
    }

    // ---- immediate live re-sync so fresh domains + credentials are returned ----
    const itemId = order?.api_response?.items?.[0]?.id
    let fresh = null
    if (itemId) {
      const stRes = await fetch(`${GG2}/certificates/caas/${encodeURIComponent(itemId)}`, { headers: ggHeaders() })
      if (stRes.ok) fresh = await stRes.json()
    }
    if (fresh) {
      const up = await fetch(`${SB()}/rest/v1/orders?id=eq.${encodeURIComponent(order_id)}`, {
        method: 'PATCH',
        headers: { ...H(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          api_response: fresh,
          status: fresh?.order?.status || undefined,
          last_synced_at: new Date().toISOString(),
        }),
      })
      if (!up.ok) console.error('Post-add sync store failed:', up.status, await up.text().catch(() => ''))
    }

    return res.status(200).json({ ok: true, added: clean, api_response: fresh, vendor_response: addBody })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Domain addition failed.', detail: String(err.message || err) })
  }
}
