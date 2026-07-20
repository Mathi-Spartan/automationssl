// /api/subaccount — reseller-only customer account management.
//
//   POST  — create a customer under the calling reseller (Supabase admin API,
//           service role) and link it via profiles.parent_reseller_id.
//           Body: { email, password, full_name, company_name }.
//   PATCH — update one of the caller's own customers.
//           Body: { customer_id, full_name?, company_name?, email?, password? }.
//
// Both paths require the caller to be a reseller. PATCH additionally requires
// the target's parent_reseller_id to equal the caller's id, so a reseller
// cannot edit another reseller's customer, another reseller, or themselves.

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
    const pr = await fetch(`${SB()}/rest/v1/profiles?id=eq.${user.id}&select=account_type,can_create_resellers`, {
      headers: { apikey: SRK(), Authorization: `Bearer ${SRK()}` },
    })
    const rows = await pr.json()
    if (rows?.[0]?.account_type !== 'reseller')
      return res.status(403).json({ error: true, message: 'Only reseller accounts can manage customer accounts.' })
    const callerCanCreateResellers = rows?.[0]?.can_create_resellers === true

    if (req.method === 'PATCH') return updateCustomer(req, res, user)

    const { email, password, full_name, company_name, account_type, parent_id, markup_pct } = req.body || {}

    // The account is created under whoever is being VIEWED, not whoever holds
    // the token. A master drilled into a sub-reseller's customers page is still
    // authenticated as the master, so using user.id here silently attached the
    // new account to the master instead of the reseller on screen.
    let parentId = user.id
    // Only a sub-reseller's customers carry a markup — a master's customer pays
    // list, so resolve_price would ignore one. The caller is a sub-reseller iff
    // they are a reseller who cannot create resellers; a named parent is one iff
    // it has a parent of its own.
    let parentIsSubReseller = !callerCanCreateResellers
    if (parent_id && parent_id !== user.id) {
      const target = await getProfile(parent_id)
      if (!target || target.account_type !== 'reseller')
        return res.status(400).json({ error: true, message: 'That parent account cannot hold customers.' })
      if (!(await inSubtree(user.id, parent_id)))
        return res.status(403).json({ error: true, message: 'That account is not on your hierarchy.' })
      parentId = parent_id
      parentIsSubReseller = !!target.parent_reseller_id
    }
    if (markup_pct != null && ![10, 20, 30].includes(Number(markup_pct)))
      return res.status(400).json({ error: true, message: 'Markup slab must be 10, 20 or 30 percent.' })

    // Only a master may create another reseller. Without this check any
    // reseller could POST account_type:'reseller' and mint a peer.
    // Creating on someone else's behalf can only ever make a retail customer.
    // A reseller under a sub-reseller would be a third level, and the model is
    // master -> reseller -> customer.
    const newType = (parentId !== user.id || account_type !== 'reseller') ? 'customer' : 'reseller'
    if (newType === 'reseller' && !callerCanCreateResellers)
      return res.status(403).json({ error: true, message: 'Your account cannot create reseller accounts.' })
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
      body: JSON.stringify({
        parent_reseller_id: parentId,
        account_type: newType,
        // Markup is set at creation now. Only a sub-reseller's customer may
        // carry one: a master's customer pays list, so resolve_price would
        // ignore it.
        ...(markup_pct != null && newType === 'customer' && parentIsSubReseller
          ? { markup_pct: Number(markup_pct) }
          : {}),
        email: String(email).trim().toLowerCase(),
        ...(company_name ? { company_name: String(company_name).trim() } : {}),
      }),
    })
    if (!up.ok) console.error('Sub-account link failed:', up.status, await up.text().catch(() => ''))

    return res.status(200).json({ ok: true, user_id: created.id })
  } catch (err) {
    return res.status(500).json({ error: true, message: 'Sub-account creation failed.', detail: String(err.message || err) })
  }
}

/* One profile row, service role. */
async function getProfile(id) {
  const r = await fetch(
    `${SB()}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id,parent_reseller_id,email,account_type`,
    { headers: { apikey: SRK(), Authorization: `Bearer ${SRK()}` } },
  )
  return (await r.json())?.[0] || null
}

/* Is `id` anywhere below `root`? Uses the same descendants_of the RLS read
   policy uses, so API permission and row visibility cannot drift apart. */
async function inSubtree(root, id) {
  const r = await fetch(`${SB()}/rest/v1/rpc/descendants_of`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SRK(), Authorization: `Bearer ${SRK()}` },
    body: JSON.stringify({ root }),
  })
  if (!r.ok) return false
  const rows = await r.json()
  return (rows || []).some((x) => (typeof x === 'string' ? x : x?.descendants_of) === id)
}

/* PATCH — update one of the caller's own customers. The reseller check has
   already run; this adds the ownership check and applies the changes. */
async function updateCustomer(req, res, user) {
  const { customer_id, full_name, company_name, email, password, discount_pct, markup_pct } = req.body || {}
  if (!customer_id) return res.status(400).json({ error: true, message: 'customer_id is required.' })

  const target = await getProfile(customer_id)
  if (!target) return res.status(404).json({ error: true, message: 'Customer not found.' })

  // A reseller sets their OWN markup, so the target may be the caller. That is
  // the only field self-editing may touch: this runs under the service role, so
  // guard_profile_self_update (which keys on auth.uid()) does not fire here and
  // a self-PATCH of discount_pct would be straight privilege escalation.
  const isSelf = customer_id === user.id
  if (isSelf) {
    const touchesAnythingElse =
      discount_pct !== undefined || full_name != null || company_name != null ||
      (email != null && String(email).length > 0) || (password != null && String(password).length > 0)
    if (touchesAnythingElse)
      return res.status(403).json({ error: true, message: 'Only your markup can be changed on your own account.' })
  } else if (target.parent_reseller_id !== user.id && !(await inSubtree(user.id, customer_id))) {
    // Direct children were the only ones allowed before, which refused every
    // edit made while viewing a sub-reseller's customers.
    return res.status(403).json({ error: true, message: 'That customer is not on your account.' })
  }

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
    const ar = await fetch(`${SB()}/auth/v1/admin/users/${encodeURIComponent(customer_id)}`, {
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
  // Only a reseller can hold a discount slab; a retail customer always pays list.
  if (discount_pct !== undefined) {
    if (target.account_type !== 'reseller')
      return res.status(400).json({ error: true, message: 'Only reseller accounts can have a discount slab.' })
    if (discount_pct !== null && ![40, 50, 60].includes(Number(discount_pct)))
      return res.status(400).json({ error: true, message: 'Discount slab must be 40, 50 or 60 percent.' })
    profilePatch.discount_pct = discount_pct === null ? null : Number(discount_pct)
  }
  // markup_pct means two things by row type: on a reseller it is their default
  // for all their customers; on a customer it overrides that default for them
  // alone, with null meaning inherit. A master's direct customer always pays
  // list, so an override there would be silently ignored by resolve_price —
  // refuse it rather than store a number that does nothing.
  if (markup_pct !== undefined) {
    if (target.account_type !== 'reseller') {
      const parent = target.parent_reseller_id ? await getProfile(target.parent_reseller_id) : null
      if (!parent || parent.account_type !== 'reseller' || !parent.parent_reseller_id)
        return res.status(400).json({
          error: true,
          message: 'Only a sub-reseller\'s customers can have their own markup.',
        })
    }
    if (markup_pct !== null && ![10, 20, 30].includes(Number(markup_pct)))
      return res.status(400).json({ error: true, message: 'Markup slab must be 10, 20 or 30 percent.' })
    profilePatch.markup_pct = markup_pct === null ? null : Number(markup_pct)
  }
  if (full_name != null) profilePatch.full_name = String(full_name).trim()
  if (company_name != null) profilePatch.company_name = String(company_name).trim() || null
  if (cleanEmail) profilePatch.email = cleanEmail

  if (Object.keys(profilePatch).length) {
    const up = await fetch(`${SB()}/rest/v1/profiles?id=eq.${encodeURIComponent(customer_id)}`, {
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
    // Echo what was written so the caller can render the saved value without a
    // second round trip; the profile PATCH uses return=minimal.
    applied: profilePatch,
  })
}
