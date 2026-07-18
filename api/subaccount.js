// POST /api/subaccount — reseller-only. Creates a customer account under the
// calling reseller (Supabase admin API, service role) and links it via
// profiles.parent_reseller_id. Body: { email, password, full_name }.

const SB = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SRK = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Method not allowed' })

  try {
    const user = await resolveUser(req)
    if (!user?.id) return res.status(401).json({ error: true, message: 'Please sign in.' })

    // caller must be a reseller
    const pr = await fetch(`${SB()}/rest/v1/profiles?id=eq.${user.id}&select=account_type`, {
      headers: { apikey: SRK(), Authorization: `Bearer ${SRK()}` },
    })
    const rows = await pr.json()
    if (rows?.[0]?.account_type !== 'reseller')
      return res.status(403).json({ error: true, message: 'Only reseller accounts can create customer accounts.' })

    const { email, password, full_name } = req.body || {}
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ error: true, message: 'A valid email is required.' })
    if (!password || String(password).length < 8)
      return res.status(400).json({ error: true, message: 'Password must be at least 8 characters.' })

    // create the auth user (email pre-confirmed — reseller hands over credentials)
    const cr = await fetch(`${SB()}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}` },
      body: JSON.stringify({
        email: String(email).trim().toLowerCase(),
        password: String(password),
        email_confirm: true,
        user_metadata: { full_name: String(full_name || '').trim() },
      }),
    })
    const created = await cr.json()
    if (!cr.ok || !created?.id)
      return res.status(400).json({ error: true, message: created?.msg || created?.message || 'Could not create the account.' })

    // link to the reseller (profile row exists via signup trigger)
    const up = await fetch(`${SB()}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ parent_reseller_id: user.id }),
    })
    if (!up.ok) console.error('Sub-account link failed:', up.status, await up.text().catch(() => ''))

    return res.status(200).json({ ok: true, user_id: created.id })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Sub-account creation failed.', detail: String(err.message || err) })
  }
}
