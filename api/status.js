// GET /api/status?order_id=..&email=.. — verifies the email matches the order in
// Supabase, then returns live V2 status from GoGetSSL:
//   - product 300: ACME EAB credentials (eab_kid, eab_hmac_key, server_url)
//   - products 400-403: AutoInstall setup link (autoinstall.login_sso_link)

const GG2 = 'https://my.gogetssl.com/api/v2'

function ggHeaders() {
  const code = (process.env.GOGETSSL_PARTNER_CODE || '133617').trim()
  const pass = (process.env.GOGETSSL_PASS || '').trim()
  return { Authorization: `GGS ${code}:${pass}`, Accept: 'application/json' }
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
      select: 'gogetssl_order_id,product_id,product_name,domain,period,api_response',
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

    // -------- live status from GoGetSSL V2 --------
    const category = Number(record.product_id) === 300 ? 'acme' : 'ais'
    const itemId = record?.api_response?.items?.[0]?.id || record.gogetssl_order_id

    const stRes = await fetch(`${GG2}/certificates/${category}/${encodeURIComponent(itemId)}`, {
      headers: ggHeaders(),
    })
    const st = await stRes.json()

    const item = st?.items?.[0] || {}
    const out = {
      status: st?.order?.status || 'pending',
      product_name: record.product_name,
      domain: record.domain,
      period_start: item?.subscription?.begin || null,
      next_renewal: item?.subscription?.next_renewal || null,
      acme: null,
      autoinstall: null,
    }

    // ACME EAB credentials (Sectigo CaaS)
    const acme = {}
    const scan = (obj) => {
      for (const [k, v] of Object.entries(obj || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v)) scan(v)
        else if (/eab|server_url|acme_account|directory/i.test(k) && v) acme[k] = v
      }
    }
    scan(st)
    if (Object.keys(acme).length) out.acme = acme

    // AutoInstall link (Plan + Automate)
    if (item.autoinstall) {
      out.autoinstall = {
        setup_link: item.autoinstall.login_sso_link || item.autoinstall.manage_sso_link || null,
        status: item.autoinstall.status || null,
      }
    }

    return res.status(200).json(out)
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Status lookup failed.', detail: String(err.message || err) })
  }
}
