import { useEffect, useRef, useState, useCallback } from 'react'
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
  const isAcme = Number(order.product_id) === 300
  if (isAcme) scan(order.api_response)
  const aiStatus = item?.autoinstall?.status || null
  const vendorDomains = Array.isArray(item?.domains) ? item.domains : []
  return {
    setupLink: link,
    aiStatus,
    acme: Object.keys(acme).length ? acme : null,
    renewal: item?.subscription?.next_renewal || null,
    vendorDomains,
    agentInstalled: Boolean(item?.autoinstall?.installation_method) || (aiStatus && aiStatus !== 'incomplete'),
    isAcme,
    activated: isAcme ? true : Boolean(aiStatus && aiStatus !== 'incomplete'),
  }
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = Math.ceil((new Date(dateStr) - Date.now()) / 86_400_000)
  return Number.isFinite(d) ? d : null
}

function fmtDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return dateStr
  }
}

async function refreshPending(orders) {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) return false
  const pending = orders.filter((o) => !deliverables(o).activated)
  if (pending.length === 0) return false
  const results = await Promise.all(
    pending.map((o) =>
      fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ order_id: o.id }),
      }).then((r) => r.json()).catch(() => null)
    )
  )
  return results.some((r) => r?.refreshed)
}

// ---------- UI atoms ----------

function Stats({ items }) {
  return (
    <div className="stat-strip">
      {items.map(([label, value, sub]) => (
        <div className="stat" key={label}>
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
          {sub && <div className="stat-sub">{sub}</div>}
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

function Journey({ d }) {
  const steps = d.isAcme
    ? [
        { label: 'Ordered', done: true },
        { label: 'Configure ACME client', done: d.vendorDomains.length > 0 },
        { label: 'Automated', done: d.vendorDomains.length > 0 },
      ]
    : [
        { label: 'Ordered', done: true },
        { label: 'Install agent', done: d.agentInstalled },
        { label: 'Add your domain', done: d.vendorDomains.length > 0 },
        { label: 'Automated', done: d.activated && d.vendorDomains.length > 0 },
      ]
  const current = steps.findIndex((s) => !s.done)
  return (
    <div className="journey" role="list" aria-label="Activation progress">
      {steps.map((s, i) => (
        <div key={s.label} role="listitem"
          className={'jstep' + (s.done ? ' done' : i === current ? ' current' : '')}>
          <span className="jdot">{s.done ? '✓' : i + 1}</span>
          <span className="jlabel">{s.label}</span>
          {i < steps.length - 1 && <span className="jline" aria-hidden="true" />}
        </div>
      ))}
    </div>
  )
}

function PlanCard({ order, isReseller, servers, onAssignServer, onCheck, checking, children }) {
  const d = deliverables(order)
  const days = daysUntil(d.renewal)
  return (
    <div className={'plan-card' + (d.activated ? ' activated' : '')}>
      <div className="plan-head">
        <strong>{order.product_name}</strong>
        <OriginBadge order={order} isReseller={isReseller} />
      </div>

      <Journey d={d} />

      {d.activated ? (
        <p className="plan-note ok-note">
          🎉 <b>Automation is live.</b> Issuance and renewals are hands-off from here
          {d.renewal && <> — covered until <b>{fmtDate(d.renewal)}</b>{days != null && <> ({days} days), renews automatically</>}</>}.
        </p>
      ) : (
        <div className="plan-note">
          <b>You're {d.agentInstalled ? '1 step' : 'about 5 minutes'} away.</b>
          <ol className="checklist">
            <li className={d.setupLink ? '' : 'muted'}>Open your personal setup portal below.</li>
            <li className={d.agentInstalled ? 'done' : ''}>Copy the one-line install command onto your server and run it.</li>
            <li className={d.vendorDomains.length ? 'done' : ''}>Add the domain you want secured — we'll detect it automatically.</li>
          </ol>
        </div>
      )}

      <div className="kv" style={{ marginTop: 8 }}>
        <div><b>Order ID</b> {order.gogetssl_order_id}</div>
        {!d.activated && d.renewal && <div><b>Plan runs until</b> {fmtDate(d.renewal)}</div>}
      </div>

      {d.vendorDomains.length > 0 && (
        <div className="chips" style={{ marginTop: 6 }}>
          {d.vendorDomains.map((dom) => (
            <span className="chip lock" key={typeof dom === 'string' ? dom : JSON.stringify(dom)}>
              🔒 {typeof dom === 'string' ? dom : dom?.name || dom?.domain || ''}
            </span>
          ))}
        </div>
      )}

      <div className="plan-actions">
        {d.setupLink && (
          <a className="btn primary" href={d.setupLink} target="_blank" rel="noreferrer">
            {d.activated ? 'Open automation portal →' : 'Activate — open setup portal →'}
          </a>
        )}
        {!d.activated && !d.isAcme && onCheck && (
          <button className="btn ghost" type="button" disabled={checking} onClick={() => onCheck(order)}>
            {checking ? 'Checking…' : 'Check my setup'}
          </button>
        )}
      </div>

      {d.acme && (
        <details style={{ marginTop: 10 }}>
          <summary><strong>ACME enrollment credentials</strong> — works with certbot, acme.sh, Caddy…</summary>
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

// Shared polling: while any plan is pending, re-sync every 30s (backend throttles the vendor call).
function usePendingPoll(orders, reload) {
  const prevPending = useRef(new Set())
  const [celebrate, setCelebrate] = useState(null)

  useEffect(() => {
    if (!orders) return
    const pendingIds = new Set(orders.filter((o) => !deliverables(o).activated).map((o) => o.id))
    // celebration: something that was pending is now activated
    const flipped = [...prevPending.current].filter((id) => !pendingIds.has(id) && orders.some((o) => o.id === id))
    if (flipped.length > 0) {
      const o = orders.find((x) => x.id === flipped[0])
      setCelebrate(`${o.product_name} is now fully automated — nice work! 🎉`)
      setTimeout(() => setCelebrate(null), 12_000)
    }
    prevPending.current = pendingIds
    if (pendingIds.size === 0) return
    const t = setInterval(async () => {
      if (document.hidden) return
      if (await refreshPending(orders)) reload()
    }, 30_000)
    return () => clearInterval(t)
  }, [orders, reload])

  return celebrate
}

// ---------- customer view ----------

function CustomerDashboard({ session, profile }) {
  const [orders, setOrders] = useState(null)
  const [servers, setServers] = useState([])
  const [domains, setDomains] = useState([])
  const [checking, setChecking] = useState(null)
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

  const celebrate = usePendingPoll(orders, load)

  async function assignServer(orderId, serverId) {
    const { error } = await supabase.from('orders').update({ server_id: serverId || null }).eq('id', orderId)
    if (!error) setOrders((os) => os.map((o) => (o.id === orderId ? { ...o, server_id: serverId || null } : o)))
  }

  async function checkNow(order) {
    setChecking(order.id)
    await refreshPending([order])
    await load()
    setChecking(null)
  }

  const pending = (orders || []).filter((o) => !deliverables(o).activated)
  const active = (orders || []).filter((o) => deliverables(o).activated)
  const renewals = (orders || []).map((o) => deliverables(o).renewal).filter(Boolean).sort()
  const securedDomains = (orders || []).reduce((n, o) => n + deliverables(o).vendorDomains.length, 0)

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
        ['Pending activation', orders ? pending.length : '…', pending.length ? 'action needed' : 'all clear'],
        ['Activated', orders ? active.length : '…', active.length ? 'renewing automatically' : null],
        ['Servers', servers.length],
        ['Domains tracked', domains.length, securedDomains ? `${securedDomains} secured` : null],
      ]} />
      {orders && orders.length > 0 && (
        <p className="overview-line">
          {orders.length} plan{orders.length === 1 ? '' : 's'}
          {securedDomains > 0 && <> securing {securedDomains} domain{securedDomains === 1 ? '' : 's'}</>}
          {servers.length > 0 && <> across {servers.length} server{servers.length === 1 ? '' : 's'}</>}
          {renewals[0] && <> · earliest renewal <b>{fmtDate(renewals[0])}</b> — handled automatically once activated</>}.
        </p>
      )}

      {celebrate && <div className="alert ok celebrate">{celebrate}</div>}
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
            <PlanCard key={o.id} order={o} isReseller={false} servers={servers}
              onAssignServer={assignServer} onCheck={checkNow} checking={checking === o.id} />
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
  const [checking, setChecking] = useState(null)
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

  const allOrders = own ? [...own, ...subOrders] : null
  const celebrate = usePendingPoll(allOrders, load)

  async function assignServer(orderId, serverId) {
    const { error } = await supabase.from('orders').update({ server_id: serverId || null }).eq('id', orderId)
    if (!error) setOwn((os) => os.map((o) => (o.id === orderId ? { ...o, server_id: serverId || null } : o)))
  }

  async function checkNow(order) {
    setChecking(order.id)
    await refreshPending([order])
    await load()
    setChecking(null)
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
        ['Inventory', own ? inventory.length : '…', 'unassigned'],
        ['Assigned', assigned.length, 'to customers'],
        ['Activated by you', ownActivated.length],
        ['Customers', subs.length],
        ['Customer servers', subServers.length],
        ['Customer domains', subDomains.length],
      ]} />

      {celebrate && <div className="alert ok celebrate">{celebrate}</div>}
      {err && <div className="alert error">{err}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <h2 className="section-h">Your inventory</h2>
      {own && inventory.length === 0 && (
        <div className="alert ok">
          No unassigned plans. <Link to="/#plans" style={{ textDecoration: 'underline' }}>Buy a plan</Link> to stock inventory.
        </div>
      )}
      {inventory.map((o) => (
        <PlanCard key={o.id} order={o} isReseller servers={servers}
          onAssignServer={assignServer} onCheck={checkNow} checking={checking === o.id}>
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
              <div className="plan-card" key={c.id}>
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
