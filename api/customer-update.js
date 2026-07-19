// PATCH /api/customer-update — reseller-only. Updates one of the caller's own
// customers: name, company, email and/or password. Body:
// { customer_id, full_name?, company_name?, email?, password? }
//
// Ownership is enforced server-side: the target profile's parent_reseller_id
// must equal the caller's id. A reseller cannot edit anyone else's customer,
// another reseller, or themselves through this route.

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
  if (req.method !== 'POST' && req.method !== 'PATCH')
    return res.status(405).json({ error: true, message: 'Method not allowed' })

  try {
    const user = await resolveUser(req)
    if (!user?.id) return res.status(401).json({ error: true, message: 'Please sign in.' })

    // caller must be a reseller
    const pr = await fetch(`${SB()}/rest/v1/profiles?id=eq.${user.id}&select=account_type`, {
      headers: { apikey: SRK(), Authorization: `Bearer ${SRK()}` },
    })
    const me = await pr.json()
    if (me?.[0]?.account_type !== 'reseller')
      return res.status(403).json({ error: true, message: 'Only reseller accounts can edit customers.' })

    const { customer_id, full_name, company_name, email, password } = req.body || {}
    if (!customer_id) return res.status(400).json({ error: true, message: 'customer_id is required.' })

    // the target must be one of this reseller's own customers
    const tr = await fetch(
      `${SB()}/rest/v1/profiles?id=eq.${customer_id}&select=id,parent_reseller_id,email`,
      { headers: { apikey: SRK(), Authorization: `Bearer ${SRK()}` } },
    )
    const target = (await tr.json())?.[0]
    if (!target) return res.status(404).json({ error: true, message: 'Customer not found.' })
    if (target.parent_reseller_id !== user.id)
      return res.status(403).json({ error: true, message: 'That customer is not on your account.' })

    // validate what was sent
    const cleanEmail = email == null ? null : String(email).trim().toLowerCase()
    if (cleanEmail !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail))
      return res.status(400).json({ error: true, message: 'A valid email is required.' })
    if (password != null && String(password).length > 0 && String(password).length < 8)
      return res.status(400).json({ error: true, message: 'Password must be at least 8 characters.' })

    // auth-side changes (email and/or password)
    const authPatch = {}
    if (cleanEmail && cleanEmail !== target.email) {
      authPatch.email = cleanEmail
      authPatch.email_confirm = true
    }
    if (password) authPatch.password = String(password)

    if (Object.keys(authPatch).length) {
      const ar = await fetch(`${SB()}/auth/v1/admin/users/${customer_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}` },
        body: JSON.stringify(authPatch),
      })
      if (!ar.ok) {
        const body = await ar.json().catch(() => ({}))
        return res.status(400).json({
          error: true,
          message: body?.msg || body?.message || 'Could not update the login details.',
        })
      }
    }

    // profile-side changes
    const profilePatch = {}
    if (full_name != null) profilePatch.full_name = String(full_name).trim()
    if (company_name != null) profilePatch.company_name = String(company_name).trim() || null
    if (cleanEmail) profilePatch.email = cleanEmail

    if (Object.keys(profilePatch).length) {
      const up = await fetch(`${SB()}/rest/v1/profiles?id=eq.${customer_id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SRK(),
          Authorization: `Bearer ${SRK()}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(profilePatch),
      })
      if (!up.ok)
        return res.status(400).json({ error: true, message: 'Could not save the profile changes.' })
    }

    return res.status(200).json({
      ok: true,
      changed: {
        profile: Object.keys(profilePatch),
        email: !!authPatch.email,
        password: !!authPatch.password,
      },
    })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Update failed.', detail: String(err.message || err) })
  }
}
