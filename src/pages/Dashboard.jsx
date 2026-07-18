import { useEffect, useState, useCallback } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'

// ---------- shared helpers ----------

export function deliverables(order) {
  const item = order?.api_response?.items?.[0] || {}
  const link = item?.autoinstall?.login_sso_link || item?.autoinstall?.manage_sso_link || null
  const acme = {}
  const scan = (obj) => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) scan(v)
      else if (/eab|server_url|acme_account|directory/i.test(k) && v) acme[k] = v
    }
  }
  if (Number(order.product_id) === 300) scan(order.api_response)
  const aiStatus = item?.autoinstall?.status || null
  const isAcme = Number(order.product_id) === 300
  return {
    setupLink: link,
    aiStatus,
    acme: Object.keys(acme).length ? acme : null,
    renewal: item?.subscription?.next_renewal || null,
    // ACME plans are "activated" from our side once credentials exist;
    // AIS plans are pending until the agent reports anything but incomplete.
    activated: isAcme ? true : Boolean(aiStatus && aiStatus !== 'incomplete'),
  }
}

async function refreshPending(orders) {
  // Ask the backend to re-sync any AIS plan still pending (throttled server-side).
  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) return false
  const pending = orders.filter((o) => {
    const d = deliverables(o)
    return !d.activated && Number(o.product_id) !== 300
  })
  if (pending.length === 0) return false
  const results = await Promise.all(
    pending.map((o) =>
      fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ order_id: o.id }),
      })
        .then((r) => r.json())
        .catch(() => null)
    )
  )
  return results.some((r) => r?.refreshed)
}

function Stats({ items }) {
  return (
    <div className="stat-strip">
      {items.map(([label, value]) => (
        <div className="stat" key={label}>
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
    </div>
  )
}

function OriginBadge({ order, isReseller }) {
  let text
  if (order.assigned_at) text = isReseller ? 'Assigned by you' : 'Provided by your reseller'
  else text = isReseller ? 'Your inventory' : 'Purchased by you'
  return <span className="badge">{text}</span>
}

function PlanCard({ order, isReseller, servers, onAssignServer, children }) {
  const d = deliverables(order)
  return (
    <div className="alert ok" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong>{order.product_name}</strong>
        <OriginBadge order={order} isReseller={isReseller} />
      </div>
      <div className="kv" style={{ marginTop: 8 }}>
        <div><b>Order ID</b> {order.gogetssl_order_id}</div>
        <div><b>Status</b> {order.status}</div>
        {d.renewal && <div><b>Next renewal</b> {d.renewal}</div>}
        {d.aiStatus && <div><b>Automation setup</b> {d.aiStatus}</div>}
      </div>

      {d.setupLink && (
        <div style={{ marginTop: 10 }}>
          <a className="btn primary" style={{ display: 'inline-block' }} href={d.setupLink} target="_blank" rel="noreferrer">
            {d.activated ? 'Open automation portal →' : 'Activate — open setup portal →'}
          </a>
        </div>
      )}
      {d.acme && (
        <details style={{ marginTop: 10 }}>
          <summary><strong>ACME enrollment credentials</strong></summary>
          <pre>{JSON.stringify(d.acme, null, 2)}</pre>
        </details>
      )}

      {servers && (
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: '0.82rem', marginRight: 8 }}><b>Server</b></label>
          <select value={order.server_id || ''} onChange={(e) => onAssignServer(order.id, e.target.value)}>
            <option value="">— not assigned —</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>
            ))}
          </select>
        </div>
      )}
      {children}
    </div>
  )
}

// ---------- customer view ----------

function CustomerDashboard({ session, profile }) {
  const [orders, setOrders] = useState(null)
  const [servers, setServers] = useState([])
  const [domains, setDomains] = useState([])
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    const [o, s, d] = await Promise.all([
      supabase.from('orders').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      supabase.from('servers').select('id, name, environment').eq('owner_id', session.user.id).order('name'),
      supabase.from('tracked_domains').select('id').eq('owner_id', session.user.id),
    ])
    setOrders(o.data || [])
    setServers(s.data || [])
    setDomains(d.data || [])
    setErr(o.error?.message || null)
    return o.data || []
  }, [session.user.id])

  useEffect(() => {
    load().then(async (data) => {
      if (await refreshPending(data)) load()
    })
  }, [load])

  async function assignServer(orderId, serverId) {
    const { error } = await supabase.from('orders').update({ server_id: serverId || null }).eq('id', orderId)
    if (!error) setOrders((os) => os.map((o) => (o.id === orderId ? { ...o, server_id: serverId || null } : o)))
  }

  const pending = (orders || []).filter((o) => !deliverables(o).activated)
  const active = (orders || []).filter((o) => deliverables(o).activated)

  return (
    <div className="form-page wide">
      <span className="eyebrow">Dashboard</span>
      <h1>Your plans{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1>
      <p className="sub">
        Activate automation, check renewals, and tag each plan to the server it runs on.{' '}
        <Link to="/dashboard/servers" style={{ textDecoration: 'underline' }}>Manage servers</Link>
      </p>

      <Stats items={[
        ['Plans', orders?.length ?? '…'],
        ['Pending activation', orders ? pending.length : '…'],
        ['Activated', orders ? active.length : '…'],
        ['Servers', servers.length],
        ['Domains', domains.length],
      ]} />

      {err && <div className="alert error">{err}</div>}
      {orders && orders.length === 0 && (
        <div className="alert ok">
          No plans yet. <Link to="/#plans" style={{ textDecoration: 'underline' }}>Choose a plan</Link> — everything is free during the testing phase.
        </div>
      )}

      {pending.length > 0 && (
        <>
          <h2 className="section-h">Needs activation</h2>
          {pending.map((o) => (
            <PlanCard key={o.id} order={o} isReseller={false} servers={servers} onAssignServer={assignServer} />
          ))}
        </>
      )}
      {active.length > 0 && (
        <>
          <h2 className="section-h">Active &amp; automated</h2>
          {active.map((o) => (
            <PlanCard key={o.id} order={o} isReseller={false} servers={servers} onAssignServer={assignServer} />
          ))}
        </>
      )}
    </div>
  )
}

// ---------- reseller view ----------

function ResellerDashboard({ session, profile }) {
  const [own, setOwn] = useState(null)
  const [subOrders, setSubOrders] = useState([])
  const [subs, setSubs] = useState([])
  const [servers, setServers] = useState([])
  const [subServers, setSubServers] = useState([])
  const [subDomains, setSubDomains] = useState([])
  const [assignTo, setAssignTo] = useState({})
  const [busyAssign, setBusyAssign] = useState(null)
  const [err, setErr] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    const uid = session.user.id
    const [o, so, p, s, ss, sd] = await Promise.all([
      supabase.from('orders').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
      supabase.from('orders').select('*').neq('user_id', uid).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').eq('parent_reseller_id', uid).order('created_at'),
      supabase.from('servers').select('id, name, environment').eq('owner_id', uid).order('name'),
      supabase.from('servers').select('id, owner_id').neq('owner_id', uid),
      supabase.from('tracked_domains').select('id, owner_id').neq('owner_id', uid),
    ])
    setOwn(o.data || [])
    setSubOrders(so.data || [])
    setSubs(p.data || [])
    setServers(s.data || [])
    setSubServers(ss.data || [])
    setSubDomains(sd.data || [])
    setErr(o.error?.message || so.error?.message || null)
    return [...(o.data || []), ...(so.data || [])]
  }, [session.user.id])

  useEffect(() => {
    load().then(async (all) => {
      if (await refreshPending(all)) load()
    })
  }, [load])

  async function assignServer(orderId, serverId) {
    const { error } = await supabase.from('orders').update({ server_id: serverId || null }).eq('id', orderId)
    if (!error) setOwn((os) => os.map((o) => (o.id === orderId ? { ...o, server_id: serverId || null } : o)))
  }

  async function assign(order) {
    const customerId = assignTo[order.id]
    if (!customerId) return
    const target = subs.find((c) => c.id === customerId)
    if (!confirm(`Assign "${order.product_name}" (#${order.gogetssl_order_id}) to ${target?.full_name || 'this customer'}?\n\nThis is PERMANENT — it can never be reassigned to anyone else.`)) return
    setBusyAssign(order.id)
    setErr(null)
    setNotice(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
        body: JSON.stringify({ order_id: order.id, customer_id: customerId }),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.message || 'Assignment failed.')
      setNotice(`${body.product_name} #${body.gogetssl_order_id} permanently assigned to ${body.assigned_to}.`)
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyAssign(null)
    }
  }

  const inventory = (own || []).filter((o) => !o.assigned_at)
  const ownActivated = inventory.filter((o) => deliverables(o).activated)
  const assigned = subOrders.filter((o) => o.assigned_by === session.user.id)

  return (
    <div className="form-page wide">
      <span className="eyebrow">Reseller dashboard</span>
      <h1>Your business{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1>
      <p className="sub">
        Buy plans from the <Link to="/#plans" style={{ textDecoration: 'underline' }}>Plans page</Link> to stock inventory —
        then activate them yourself or assign them to a customer.{' '}
        <Link to="/dashboard/customers" style={{ textDecoration: 'underline' }}>Customer console</Link> ·{' '}
        <Link to="/dashboard/servers" style={{ textDecoration: 'underline' }}>Your servers</Link>
      </p>

      <Stats items={[
        ['Inventory (unassigned)', own ? inventory.length : '…'],
        ['Assigned to customers', assigned.length],
        ['Activated by you', ownActivated.length],
        ['Customers', subs.length],
        ['Customer servers', subServers.length],
        ['Customer domains', subDomains.length],
      ]} />

      {err && <div className="alert error">{err}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <h2 className="section-h">Your inventory</h2>
      {own && inventory.length === 0 && (
        <div className="alert ok">
          No unassigned plans. <Link to="/#plans" style={{ textDecoration: 'underline' }}>Buy a plan</Link> to stock inventory.
        </div>
      )}
      {inventory.map((o) => (
        <PlanCard key={o.id} order={o} isReseller servers={servers} onAssignServer={assignServer}>
          {subs.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ fontSize: '0.82rem' }}><b>Assign to customer</b></label>
              <select value={assignTo[o.id] || ''} onChange={(e) => setAssignTo({ ...assignTo, [o.id]: e.target.value })}>
                <option value="">— choose customer —</option>
                {subs.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name || c.id.slice(0, 8)}</option>
                ))}
              </select>
              <button className="btn ghost" type="button" disabled={!assignTo[o.id] || busyAssign === o.id} onClick={() => assign(o)}>
                {busyAssign === o.id ? 'Assigning…' : 'Assign (permanent)'}
              </button>
            </div>
          )}
        </PlanCard>
      ))}

      {assigned.length > 0 && (
        <>
          <h2 className="section-h">Assigned to customers</h2>
          {subs.map((c) => {
            const co = assigned.filter((o) => o.user_id === c.id)
            if (co.length === 0) return null
            return (
              <div className="alert ok" key={c.id} style={{ marginBottom: 14 }}>
                <strong>{c.full_name || 'Customer'}</strong>
                <div className="kv" style={{ marginTop: 8 }}>
                  {co.map((o) => {
                    const d = deliverables(o)
                    return (
                      <div key={o.id}>
                        <b>{o.product_name}</b> #{o.gogetssl_order_id} — {d.activated ? 'activated ✓' : 'waiting on customer setup'}
                        {' '}<span className="badge">assigned — locked</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// ---------- entry ----------

export default function Dashboard() {
  const { session, profile, loading } = useAuth()
  if (loading || (session && !profile)) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard' }} />
  return profile.account_type === 'reseller'
    ? <ResellerDashboard session={session} profile={profile} />
    : <CustomerDashboard session={session} profile={profile} />
}
