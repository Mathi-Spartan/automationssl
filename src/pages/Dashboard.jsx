import { useEffect, useRef, useState, useCallback } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'

// ---------- shared helpers ----------

export function deliverables(order) {
  const item = order?.api_response?.items?.[0] || {}
  const link = item?.autoinstall?.login_sso_link || item?.autoinstall?.manage_sso_link || null
  const isAcme = Number(order.product_id) === 300
  const account = item?.account || null
  // CaaS credentials live at items[0].account: eab_mac_id / eab_mac_key / server_url.
  // account.status is "pending" until the customer's ACME client registers.
  let acme = null
  if (isAcme && account?.eab_mac_key && account?.server_url) {
    // Values passed through verbatim from the CA — no fallbacks, no synthesis.
    acme = {
      eab_kid: account.eab_mac_id || account.id,
      eab_hmac_key: account.eab_mac_key,
      server_url: account.server_url,
    }
  }
  const aiStatus = item?.autoinstall?.status || null
  const vendorDomains = Array.isArray(item?.domains) ? item.domains : []
  const enrollReady = Boolean(acme)
  const clientRegistered = Boolean(account?.status && account.status !== 'pending')
  return {
    setupLink: link,
    aiStatus,
    acme,
    renewal: item?.subscription?.next_renewal || null,
    begin: item?.subscription?.begin || null,
    caOrderStatus: order?.api_response?.order?.status || null,
    acmeAccountStatus: account?.status || null,
    vendorDomains,
    agentInstalled: Boolean(item?.autoinstall?.installation_method) || (aiStatus && aiStatus !== 'incomplete'),
    isAcme,
    enrollReady,
    activated: isAcme ? clientRegistered : Boolean(aiStatus && aiStatus !== 'incomplete'),
  }
}

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="copy-btn" onClick={async () => {
      try { await navigator.clipboard.writeText(text) } catch { /* noop */ }
      setDone(true)
      setTimeout(() => setDone(false), 1800)
    }}>
      {done ? 'Copied ✓' : label}
    </button>
  )
}

function CredRow({ label, value }) {
  return (
    <div className="cred-row">
      <span className="cred-label">{label}</span>
      <code className="cred-value">{value}</code>
      <CopyBtn text={value} />
    </div>
  )
}

function StatusVal({ value }) {
  const v = String(value).toLowerCase()
  const ok = ['active', 'complete', 'completed', 'installed', 'issued'].includes(v)
  return <span className={'status-pill ' + (ok ? 'ok' : 'warn')}>{value}</span>
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
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

export async function refreshOrders(list) {
  // Always ask the backend for a live CA sync of these orders (server throttles
  // actual vendor calls to one per 2 minutes per order).
  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token || list.length === 0) return false
  const results = await Promise.all(
    list.map((o) =>
      fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ order_id: o.id }),
      }).then((r) => r.json()).catch(() => null)
    )
  )
  return results.some((r) => r?.refreshed)
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
        { label: 'Enrollment ready', done: d.enrollReady },
        { label: 'Configure ACME client', done: d.activated },
        { label: 'Automated', done: d.activated },
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

function StagePill({ d }) {
  if (d.activated) return <span className="stage-pill ok">Automated ✓</span>
  if (d.isAcme) {
    return d.enrollReady
      ? <span className="stage-pill warn">Step 3 of 4 — configure ACME client</span>
      : <span className="stage-pill warn">Step 2 of 4 — enrollment provisioning</span>
  }
  const step = !d.agentInstalled ? 2 : 3
  const label = !d.agentInstalled ? 'install agent' : 'add your domain'
  return <span className="stage-pill warn">Step {step} of {4} — {label}</span>
}

export function SubRow({ order, isReseller, open, onToggle, children }) {
  const d = deliverables(order)
  return (
    <div className={'sub-row' + (open ? ' open' : '') + (d.activated ? ' activated' : '')}>
      <button type="button" className="sub-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="sub-row-name">
          {order.product_name}
          <span className="sub-row-id">#{order.gogetssl_order_id}</span>
        </span>
        <span className="col-stage"><StagePill d={d} /></span>
        <span className="col-renew sub-row-meta">{d.renewal ? `renews ${fmtDate(d.renewal)}` : '—'}</span>
        <span className="col-origin"><OriginBadge order={order} isReseller={isReseller} /></span>
        <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="sub-row-body">{children}</div>}
    </div>
  )
}

function PlanCard({ order, isReseller, servers, onAssignServer, onCheck, checking, noHead, children }) {
  const d = deliverables(order)
  const days = daysUntil(d.renewal)
  return (
    <div className={'plan-card' + (d.activated ? ' activated' : '') + (noHead ? ' embedded' : '')}>
      {!noHead && (
        <div className="plan-head">
          <strong>{order.product_name}</strong>
          <OriginBadge order={order} isReseller={isReseller} />
        </div>
      )}

      <Journey d={d} />

      {d.activated ? (
        <p className="plan-note ok-note">
          🎉 <b>Automation is live.</b> Issuance and renewals are hands-off from here
          {d.renewal && <> — covered until <b>{fmtDate(d.renewal)}</b>{days != null && <> ({days} days), renews automatically</>}</>}.
        </p>
      ) : d.isAcme ? (
        <div className="plan-note">
          {d.enrollReady ? (
            <>
              <b>Your enrollment credentials are ready — two steps left.</b>
              <div className="todo-steps">
                <div className="todo done"><span className="todo-dot">✓</span> Enrollment provisioned by the CA</div>
                <div className="todo current"><span className="todo-dot">1</span> Register your ACME client with the credentials below <span className="todo-sub">certbot · acme.sh · Caddy · Traefik · cert-manager</span></div>
                <div className="todo"><span className="todo-dot">2</span> Request the certificate for your domain <span className="todo-sub">renewals run on their own after that</span></div>
              </div>
              <div className="cred-card">
                <div className="cred-card-title">Your ACME credentials <span className="cred-live">live from the CA</span></div>
                <CredRow label="ACME server URL" value={d.acme.server_url} />
                <CredRow label="EAB key ID" value={d.acme.eab_kid} />
                <CredRow label="EAB HMAC key" value={d.acme.eab_hmac_key} />
                <p className="hint" style={{ fontSize: '0.76rem', marginTop: 8 }}>
                  Treat these like a password — they're yours alone. Every ACME client
                  (certbot, acme.sh, Caddy, Traefik, cert-manager) accepts these three values.
                </p>
              </div>
              <div className="cred-card cmd">
                <div className="cred-card-title">
                  Quick start with certbot
                  <CopyBtn label="Copy command" text={`certbot register --server ${d.acme.server_url} --eab-kid ${d.acme.eab_kid} --eab-hmac-key ${d.acme.eab_hmac_key}`} />
                </div>
                <pre className="acme-creds">{`certbot register \
  --server ${d.acme.server_url} \
  --eab-kid ${d.acme.eab_kid} \
  --eab-hmac-key ${d.acme.eab_hmac_key}`}</pre>
              </div>
            </>
          ) : (
            <>
              <b>The CA is provisioning your enrollment — usually a few minutes.</b>{' '}
              Use "Check my setup" below, or just wait: this page re-checks automatically.
            </>
          )}
        </div>
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

      <div className="meta-grid">
        <div className="meta-cell"><span className="meta-label">Order ID</span><span className="meta-value mono-v">{order.gogetssl_order_id}</span></div>
        {d.begin && <div className="meta-cell"><span className="meta-label">Subscription began</span><span className="meta-value">{fmtDate(d.begin)}</span></div>}
        {d.renewal && <div className="meta-cell"><span className="meta-label">Next renewal</span><span className="meta-value">{fmtDate(d.renewal)}</span></div>}
        {d.caOrderStatus && <div className="meta-cell"><span className="meta-label">CA order</span><StatusVal value={d.caOrderStatus} /></div>}
        {d.isAcme && d.acmeAccountStatus && <div className="meta-cell"><span className="meta-label">ACME account</span><StatusVal value={d.acmeAccountStatus} /></div>}
        {d.aiStatus && <div className="meta-cell"><span className="meta-label">AutoInstall</span><StatusVal value={d.aiStatus} /></div>}
      </div>

      {d.vendorDomains.length > 0 && (
        <div style={{ marginTop: 12 }}>
        <div className="meta-label" style={{ marginBottom: 6 }}>Domains</div>
        <div className="chips">
          {d.vendorDomains.map((dom) => {
            const name = typeof dom === 'string' ? dom : dom?.name || dom?.domain || ''
            return d.activated ? (
              <span className="chip lock" key={name} title="Secured — certificate active">🔒 {name}</span>
            ) : (
              <span className="chip" key={name} title="Registered with the CA — no certificate issued yet">{name} · awaiting cert</span>
            )
          })}
        </div>
        </div>
      )}

      <div className="plan-actions">
        {d.setupLink && (
          <a className="btn primary" href={d.setupLink} target="_blank" rel="noreferrer">
            {d.activated ? 'Open automation portal →' : 'Activate — open setup portal →'}
          </a>
        )}
        {!d.activated && onCheck && (
          <button className="btn ghost" type="button" disabled={checking} onClick={() => onCheck(order)}>
            {checking ? 'Checking…' : 'Check my setup'}
          </button>
        )}
      </div>

      {d.isAcme && !isReseller && (
        <p className="hint" style={{ fontSize: '0.78rem', marginTop: 10 }}>
          Need another domain on this subscription? Domains are added by your provider
          (billing is pro-rated) — contact your reseller and it appears here automatically.
        </p>
      )}

      {order.last_synced_at && (
        <p className="sync-line">⟳ Synced from the CA today at {fmtTime(order.last_synced_at)} — updates automatically.</p>
      )}

      {d.acme && d.activated && (
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
  const [open, setOpen] = useState({})
  const autoOpened = useRef(false)

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
    await refreshOrders([order])
    await load()
    setChecking(null)
  }

  const pending = (orders || []).filter((o) => !deliverables(o).activated)
  const active = (orders || []).filter((o) => deliverables(o).activated)
  const renewals = (orders || []).map((o) => deliverables(o).renewal).filter(Boolean).sort()
  const securedDomains = (orders || []).reduce((n, o) => n + deliverables(o).vendorDomains.length, 0)

  useEffect(() => {
    if (!autoOpened.current && orders && pending.length === 1) {
      autoOpened.current = true
      setOpen({ [pending[0].id]: true })
    }
  }, [orders])

  return (
    <div className="dash-page">
      <span className="eyebrow">Dashboard</span>
      <h1>Your plans{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1>
      <p className="sub">
        Activate automation, check renewals, and tag each plan to the server it runs on.{' '}
        <Link to="/dashboard/servers" style={{ textDecoration: 'underline' }}>Manage servers</Link>
      </p>

      <Stats items={[
        ['Needs attention', orders ? pending.length : '…', pending.length ? 'activate below' : 'all clear'],
        ['Automated', orders ? active.length : '…', active.length ? 'renewing automatically' : null],
        ['Servers', servers.length, securedDomains ? `${securedDomains} domain${securedDomains === 1 ? '' : 's'} secured` : null],
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
          <h2 className="section-h">Needs activation <span className="count">{pending.length}</span></h2>
          <div className="panel">
          {pending.map((o) => (
            <SubRow key={o.id} order={o} isReseller={false} open={!!open[o.id]}
              onToggle={() => { const opening = !open[o.id]; setOpen((x) => ({ ...x, [o.id]: !x[o.id] })); if (opening) refreshOrders([o]).then((r) => r && load()) }}>
              <PlanCard order={o} isReseller={false} servers={servers} noHead
                onAssignServer={assignServer} onCheck={checkNow} checking={checking === o.id} />
            </SubRow>
          ))}
          </div>
        </>
      )}
      {active.length > 0 && (
        <>
          <h2 className="section-h">Active &amp; automated <span className="count">{active.length}</span></h2>
          <div className="panel">
          {active.map((o) => (
            <SubRow key={o.id} order={o} isReseller={false} open={!!open[o.id]}
              onToggle={() => { const opening = !open[o.id]; setOpen((x) => ({ ...x, [o.id]: !x[o.id] })); if (opening) refreshOrders([o]).then((r) => r && load()) }}>
              <PlanCard order={o} isReseller={false} servers={servers} noHead onAssignServer={assignServer} />
            </SubRow>
          ))}
          </div>
        </>
      )}
    </div>
  )
}

// ---------- reseller: Sectigo CaaS multi-domain management ----------

function CaasDomainManager({ caasOrders, ownerName, onChanged }) {
  const [inputs, setInputs] = useState({})
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  if (caasOrders.length === 0) return null

  async function addDomain(o) {
    const value = (inputs[o.id] || '').trim().toLowerCase()
    if (!value) return
    if (!confirm(`Add ${value} to CaaS subscription #${o.gogetssl_order_id}?\n\nThe CA bills this pro-rated to the subscription's renewal date.`)) return
    setBusy(o.id)
    setErr(null)
    setMsg(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
        body: JSON.stringify({ order_id: o.id, domain: value }),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.message || 'Domain addition failed.')
      setMsg(`${body.added} added to #${o.gogetssl_order_id} — credentials and domains re-synced from the CA.`)
      setInputs((x) => ({ ...x, [o.id]: '' }))
      onChanged()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="r-section-head" style={{ marginTop: 8 }}>
        <div>
          <h2 className="r-section-title">Sectigo CaaS — domain management</h2>
          <p className="r-section-desc">
            One CaaS subscription can secure many domains — billed by the CA <b>pro-rated to the renewal date</b>.
            Only you (the reseller) can add domains. Customers see updated domains and credentials instantly.
          </p>
        </div>
      </div>
      {msg && <div className="alert ok">{msg}</div>}
      {err && <div className="alert error">{err}</div>}
      <div className="panel">
        {caasOrders.map((o) => {
          const d = deliverables(o)
          return (
            <div className="caas-row" key={o.id}>
              <div className="caas-head">
                <span><b>#{o.gogetssl_order_id}</b> · {ownerName(o)}</span>
                {d.acmeAccountStatus && <StatusVal value={d.acmeAccountStatus} />}
              </div>
              <div className="chips" style={{ margin: '8px 0' }}>
                {d.vendorDomains.length === 0 && <span className="muted-line">No domains yet.</span>}
                {d.vendorDomains.map((dom) => {
                  const name = typeof dom === 'string' ? dom : dom?.name || ''
                  return <span className="chip" key={name}>{name}</span>
                })}
              </div>
              <div className="chip-add">
                <input placeholder="add domain e.g. shop.example.com" value={inputs[o.id] || ''}
                  onChange={(e) => setInputs((x) => ({ ...x, [o.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDomain(o))} />
                <button className="btn primary" type="button" disabled={busy === o.id} onClick={() => addDomain(o)}>
                  {busy === o.id ? 'Adding…' : 'Add domain (pro-rated)'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>
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
  const [open, setOpen] = useState({})

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
    await refreshOrders([order])
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
    <div className="dash-page">
      <span className="eyebrow">Reseller dashboard</span>
      <h1>{profile?.full_name ? `${profile.full_name.split(' ')[0]}'s business` : 'Your business'}</h1>
      <p className="sub">
        Stock inventory by buying from the{' '}
        <Link to="/#plans">Plans page</Link>, then activate for yourself or assign to a customer.
      </p>

      {/* ---- KPI strip ---- */}
      <div className="r-kpi-strip">
        <div className="r-kpi">
          <span className="r-kpi-num">{own ? inventory.length : '—'}</span>
          <span className="r-kpi-label">Inventory</span>
          <span className="r-kpi-sub">unassigned plans</span>
        </div>
        <div className="r-kpi">
          <span className="r-kpi-num">{assigned.length}</span>
          <span className="r-kpi-label">Assigned</span>
          <span className="r-kpi-sub">to customers</span>
        </div>
        <div className="r-kpi accent">
          <span className="r-kpi-num">{ownActivated.length}</span>
          <span className="r-kpi-label">Active on your servers</span>
          <span className="r-kpi-sub">running automatically</span>
        </div>
        <div className="r-kpi">
          <span className="r-kpi-num">{subs.length}</span>
          <span className="r-kpi-label">Customers</span>
          <span className="r-kpi-sub">{subServers.length} server{subServers.length !== 1 ? 's' : ''} · {subDomains.length} domain{subDomains.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {celebrate && <div className="alert ok celebrate">{celebrate}</div>}
      {err && <div className="alert error">{err}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      {/* ---- inventory ---- */}
      <div className="r-section-head">
        <div>
          <h2 className="r-section-title">Your inventory</h2>
          <p className="r-section-desc">Plans you've purchased — activate yourself or assign to a customer (permanent).</p>
        </div>
        <Link to="/#plans" className="btn primary" style={{ alignSelf: 'flex-start' }}>+ Buy plans</Link>
      </div>

      {own && inventory.length === 0 ? (
        <div className="r-empty">
          <span className="r-empty-icon">📦</span>
          <h3>No inventory yet</h3>
          <p>Purchase plans to stock your reseller inventory — they'll appear here ready to activate or assign.</p>
          <Link to="/#plans" className="btn primary">Browse plans →</Link>
        </div>
      ) : (
        <div className="panel">
          {inventory.map((o) => (
            <SubRow key={o.id} order={o} isReseller open={!!open[o.id]}
              onToggle={() => { const opening = !open[o.id]; setOpen((x) => ({ ...x, [o.id]: !x[o.id] })); if (opening) refreshOrders([o]).then((r) => r && load()) }}>
              <PlanCard order={o} isReseller servers={servers} noHead
                onAssignServer={assignServer} onCheck={checkNow} checking={checking === o.id}>
                {subs.length > 0 && (
                  <div className="assign-row">
                    <span className="assign-label">Assign to customer</span>
                    <select value={assignTo[o.id] || ''} onChange={(e) => setAssignTo({ ...assignTo, [o.id]: e.target.value })}>
                      <option value="">— choose customer —</option>
                      {subs.map((c) => (
                        <option key={c.id} value={c.id}>{c.full_name || c.id.slice(0, 8)}</option>
                      ))}
                    </select>
                    <button className="btn primary" type="button"
                      disabled={!assignTo[o.id] || busyAssign === o.id}
                      onClick={() => assign(o)}>
                      {busyAssign === o.id ? 'Assigning…' : 'Assign permanently →'}
                    </button>
                    <p className="assign-warn">⚠ Assignment is permanent and cannot be undone.</p>
                  </div>
                )}
              </PlanCard>
            </SubRow>
          ))}
        </div>
      )}

      {/* ---- CaaS domain management ---- */}
      <CaasDomainManager
        caasOrders={[...(own || []), ...subOrders].filter((o) => Number(o.product_id) === 300)}
        ownerName={(o) => o.user_id === session.user.id ? 'your subscription' : (subs.find((c) => c.id === o.user_id)?.full_name || 'customer')}
        onChanged={load}
      />

      {/* ---- assigned to customers ---- */}
      {assigned.length > 0 && (
        <>
          <div className="r-section-head">
            <div>
              <h2 className="r-section-title">Assigned to customers</h2>
              <p className="r-section-desc">These subscriptions are permanently locked to the customer they were assigned to.</p>
            </div>
          </div>
          <div className="panel">
            {subs.map((c) => {
              const co = assigned.filter((o) => o.user_id === c.id)
              if (co.length === 0) return null
              return (
                <div className="assigned-customer-row" key={c.id}>
                  <div className="assigned-customer-head">
                    <span className="assigned-customer-name">👤 {c.full_name || 'Customer'}</span>
                    <span className="assigned-count">{co.length} plan{co.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="assigned-plans">
                    {co.map((o) => {
                      const d = deliverables(o)
                      return (
                        <div className="assigned-plan-row" key={o.id}>
                          <span className={'dot ' + (d.activated ? 'ok' : 'warn')} />
                          <span className="assigned-plan-name">{o.product_name}</span>
                          <span className="mono-v" style={{ fontSize: '0.76rem', color: 'var(--ink-soft)' }}>#{o.gogetssl_order_id}</span>
                          <StatusVal value={d.activated ? 'activated' : 'pending setup'} />
                          <span className="badge" style={{ marginLeft: 'auto' }}>locked</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
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
