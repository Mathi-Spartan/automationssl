// POST /api/allocation — set the inventory cap on one account/product.
//
// Who may set what:
//   - a master sets their OWN pool, and the caps of their sub-resellers
//   - a sub-reseller sets the caps of their own customers
//   - nobody raises their own cap unless they are the master (who has no parent
//     to grant to them)
//
// Caps are ceilings, not reservations, so a parent may grant more in total than
// they hold. That is deliberate: the master's pool is protected because every
// order decrements every ancestor, not because grants are constrained.

const SB = () => process.env.SUPABASE_URL || ''
const SRK = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const H = () => ({ 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}` })

async function resolveUser(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const r = await fetch(`${SB()}/auth/v1/user`, {
    headers: { apikey: SRK(), Authorization: `Bearer ${token}` },
  })
  if (!r.ok) return null
  return r.json()
}

const getProfile = async (id) => (await (await fetch(
  `${SB()}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id,account_type,parent_reseller_id,can_create_resellers`,
  { headers: H() },
)).json())?.[0] || null

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Method not allowed' })

  try {
    const user = await resolveUser(req)
    if (!user?.id) return res.status(401).json({ error: true, message: 'Please sign in.' })

    const { account_id, product_id, cap } = req.body || {}
    if (!account_id || product_id == null)
      return res.status(400).json({ error: true, message: 'account_id and product_id are required.' })

    const n = Number(cap)
    if (!Number.isInteger(n) || n < 0 || n > 1000000)
      return res.status(400).json({ error: true, message: 'Limit must be a whole number of 0 or more.' })

    const me = await getProfile(user.id)
    if (me?.account_type !== 'reseller')
      return res.status(403).json({ error: true, message: 'Only reseller accounts can set inventory limits.' })

    const target = await getProfile(account_id)
    if (!target) return res.status(404).json({ error: true, message: 'Account not found.' })

    const isOwnPool = account_id === user.id
    if (isOwnPool) {
      // Only the master has no one above them, so only the master tops up their
      // own pool. Anyone else raising their own cap would defeat the point.
      if (me.can_create_resellers !== true || me.parent_reseller_id)
        return res.status(403).json({ error: true, message: 'Your limit is set by your provider.' })
    } else if (target.parent_reseller_id !== user.id) {
      return res.status(403).json({ error: true, message: 'That account is not one of yours.' })
    }

    const up = await fetch(
      `${SB()}/rest/v1/allocations?account_id=eq.${encodeURIComponent(account_id)}&product_id=eq.${Number(product_id)}`,
      { method: 'PATCH', headers: { ...H(), Prefer: 'return=representation' }, body: JSON.stringify({ cap: n, updated_at: new Date().toISOString() }) },
    )
    let rows = await up.json().catch(() => [])

    // No row yet — a master's direct customer has none by design, but a newly
    // created account may simply not have been seeded.
    if (up.ok && Array.isArray(rows) && rows.length === 0) {
      const ins = await fetch(`${SB()}/rest/v1/allocations`, {
        method: 'POST', headers: { ...H(), Prefer: 'return=representation' },
        body: JSON.stringify({ account_id, product_id: Number(product_id), cap: n, used: 0 }),
      })
      rows = await ins.json().catch(() => [])
      if (!ins.ok) return res.status(400).json({ error: true, message: 'Could not create the limit.' })
    } else if (!up.ok) {
      return res.status(400).json({ error: true, message: 'Could not save the limit.' })
    }

    return res.status(200).json({ ok: true, allocation: rows?.[0] || null })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Could not save the limit.', detail: String(err.message || err) })
  }
}
