// GET /api/cron-sync — Vercel Cron Job (runs every 6 hours)
// Finds all orders not synced in the last 6 hours and refreshes them
// from the GoGetSSL V2 API. Uses service role — no user auth needed.
// Protected by CRON_SECRET env var set in Vercel.

const GG2 = 'https://my.gogetssl.com/api/v2'
const SB = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SRK = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const H = () => ({ 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}` })
function ggH() {
  const code = (process.env.GOGETSSL_PARTNER_CODE || '133617').trim()
  const pass = (process.env.GOGETSSL_PASS || '').trim()
  return { Authorization: `GGS ${code}:${pass}`, Accept: 'application/json' }
}

async function rpc(fn, body) {
  const r = await fetch(`${SB()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}` },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${fn} failed: ${r.status}`)
  const rows = await r.json()
  return Array.isArray(rows) ? rows[0] : rows
}

const nextRenewal = (payload) => payload?.items?.[0]?.subscription?.next_renewal || null

async function syncOrder(order) {
  try {
    const category = Number(order.product_id) === 300 ? 'caas' : 'ais'
    const itemId = order?.api_response?.items?.[0]?.id
    if (!itemId) return { id: order.id, skipped: true, reason: 'no item_id' }

    const r = await fetch(`${GG2}/certificates/${category}/${encodeURIComponent(itemId)}`, { headers: ggH() })
    if (!r.ok) return { id: order.id, skipped: true, reason: `vendor ${r.status}` }
    const fresh = await r.json()

    const orderStatus = fresh?.order?.status || order.status

    // There is no renewal event to listen for — the CA just renews. The only
    // signal is the renewal date moving forward, so that is what we count.
    // allow_over is deliberate: a renewal cannot be refused, so it is permitted
    // to push an account past its cap rather than be blocked. The over-limit
    // state surfaces on the Inventory page for the master to top up.
    let renewed = false
    const wasDue = nextRenewal(order.api_response)
    const nowDue = nextRenewal(fresh)
    if (wasDue && nowDue && new Date(nowDue) > new Date(wasDue)
        && order.consumes_quota !== false && order.user_id && order.product_id != null) {
      try {
        await rpc('reserve_quota', { buyer: order.user_id, prod: Number(order.product_id), qty: 1, allow_over: true })
        renewed = true
      } catch (e) {
        console.error('renewal quota consume failed for', order.id, String(e))
      }
    }

    await fetch(`${SB()}/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`, {
      method: 'PATCH',
      headers: { ...H(), Prefer: 'return=minimal' },
      body: JSON.stringify({ api_response: fresh, status: orderStatus, last_synced_at: new Date().toISOString() }),
    })
    return { id: order.id, synced: true, status: orderStatus, renewed }
  } catch (e) {
    return { id: order.id, error: String(e.message) }
  }
}

export default async function handler(req, res) {
  // Vercel sends Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.authorization || ''
  const secret = process.env.CRON_SECRET || ''
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: true, message: 'Unauthorized' })
  }

  try {
    // Find orders not synced in the last 6 hours
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    const r = await fetch(
      `${SB()}/rest/v1/orders?select=id,user_id,product_id,status,api_response,last_synced_at,consumes_quota` +
      `&or=(last_synced_at.is.null,last_synced_at.lt.${encodeURIComponent(sixHoursAgo)})` +
      `&order=last_synced_at.asc.nullsfirst&limit=100`,
      { headers: H() }
    )
    const orders = await r.json()
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(200).json({ ok: true, message: 'All orders up to date', synced: 0 })
    }

    // Sync in parallel batches of 5 to avoid rate limiting
    const results = []
    for (let i = 0; i < orders.length; i += 5) {
      const batch = orders.slice(i, i + 5)
      const batchResults = await Promise.all(batch.map(syncOrder))
      results.push(...batchResults)
      if (i + 5 < orders.length) await new Promise(r => setTimeout(r, 500))
    }

    const synced = results.filter(r => r.synced).length
    const skipped = results.filter(r => r.skipped).length
    const errors = results.filter(r => r.error).length
    console.log(`Cron sync: ${synced} synced, ${skipped} skipped, ${errors} errors`)
    return res.status(200).json({ ok: true, total: orders.length, synced, skipped, errors, results })
  } catch (e) {
    console.error('Cron sync failed:', e)
    return res.status(500).json({ error: true, message: String(e.message) })
  }
}
