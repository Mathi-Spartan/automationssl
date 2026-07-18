import React, { useEffect, useRef, useState, useCallback } from 'react'
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
  const [checking, setChecking] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(null)   // order.id or null
  const [tab, setTab] = useState('all')    // all | action | automated | expiring
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState('renewal')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(0)
  const PAGE = 25

  const load = useCallback(async () => {
    const [o, s] = await Promise.all([
      supabase.from('orders').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      supabase.from('servers').select('id, name, environment').eq('owner_id', session.user.id).order('name'),
    ])
    setOrders(o.data || [])
    setServers(s.data || [])
    setErr(o.error?.message || null)
    return o.data || []
  }, [session.user.id])

  useEffect(() => { load().then(async (data) => { if (await refreshPending(data)) load() }) }, [load])
  const celebrate = usePendingPoll(orders, load)

  async function checkNow(order) {
    setChecking(order.id)
    await refreshOrders([order])
    await load()
    setChecking(null)
  }

  const all = orders || []
  const pending = all.filter((o) => !deliverables(o).activated)
  const active  = all.filter((o) =>  deliverables(o).activated)
  const expiring = all.filter((o) => { const d = deliverables(o); if (!d.renewal) return false; return daysUntil(d.renewal) <= 60 })
  const securedDomains = all.reduce((n, o) => n + deliverables(o).vendorDomains.length, 0)
  const renewals = all.map((o) => deliverables(o).renewal).filter(Boolean).sort()

  const tabs = [
    { id: 'all',       label: 'All',          count: all.length },
    { id: 'action',    label: 'Needs action', count: pending.length },
    { id: 'automated', label: 'Automated',    count: active.length },
    { id: 'expiring',  label: 'Expiring soon',count: expiring.length },
  ]

  const caLabels = { 300: 'Sectigo', 400: 'RapidSSL', 401: 'RapidSSL', 402: 'GeoTrust', 403: 'GeoTrust' }
  const caColors = { 300: '#b8001a', 400: '#1a6bb5', 401: '#1a6bb5', 402: '#c26a00', 403: '#c26a00' }

  function filterRows(list) {
    let rows = tab === 'action' ? pending : tab === 'automated' ? active : tab === 'expiring' ? expiring : list
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter((o) => {
        const d = deliverables(o)
        return o.product_name?.toLowerCase().includes(q) ||
          String(o.gogetssl_order_id).includes(q) ||
          d.vendorDomains.some((dom) => (typeof dom === 'string' ? dom : dom?.name || '').toLowerCase().includes(q)) ||
          (caLabels[o.product_id] || '').toLowerCase().includes(q)
      })
    }
    rows = [...rows].sort((a, b) => {
      const da = deliverables(a), db = deliverables(b)
      let va, vb
      if (sortCol === 'renewal') { va = da.renewal || 'zzz'; vb = db.renewal || 'zzz' }
      else if (sortCol === 'name') { va = a.product_name || ''; vb = b.product_name || '' }
      else if (sortCol === 'ca') { va = caLabels[a.product_id] || ''; vb = caLabels[b.product_id] || '' }
      else if (sortCol === 'status') { va = da.activated ? 'z' : 'a'; vb = db.activated ? 'z' : 'a' }
      else { va = vb = '' }
      return sortDir === 'asc' ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0)
    })
    return rows
  }

  function toggleSort(col) {
    if (sortCol === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
    setPage(0)
  }

  const filtered = filterRows(all)
  const pageRows = filtered.slice(page * PAGE, (page + 1) * PAGE)
  const totalPages = Math.ceil(filtered.length / PAGE)
  const SortIcon = ({ col }) => <span style={{ fontSize: 9, color: sortCol === col ? '#3375b1' : '#c4cdd6', marginLeft: 3 }}>{sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>

  function openRow(o) {
    if (open === o.id) { setOpen(null); return }
    setOpen(o.id)
    refreshOrders([o]).then((r) => r && load())
  }

  return (
    <div className="dash-page">
      <span className="eyebrow">Certificate lifecycle manager</span>
      <h1>{profile?.full_name ? `${profile.full_name.split(' ')[0]}'s certificates` : 'My certificates'}</h1>

      {/* KPI strip */}
      <div className="clm-kpi-strip">
        <div className={'clm-kpi' + (pending.length > 0 ? ' clm-kpi-warn' : '')}>
          <i className="ti ti-alert-circle clm-kpi-icon" aria-hidden="true" />
          <div>
            <div className="clm-kpi-num">{orders ? pending.length : '…'}</div>
            <div className="clm-kpi-label">Needs action</div>
          </div>
        </div>
        <div className="clm-kpi clm-kpi-ok">
          <i className="ti ti-shield-check clm-kpi-icon" aria-hidden="true" />
          <div>
            <div className="clm-kpi-num">{orders ? active.length : '…'}</div>
            <div className="clm-kpi-label">Automated</div>
          </div>
        </div>
        <div className="clm-kpi">
          <i className="ti ti-world clm-kpi-icon" aria-hidden="true" />
          <div>
            <div className="clm-kpi-num">{securedDomains}</div>
            <div className="clm-kpi-label">Domains secured</div>
          </div>
        </div>
        <div className="clm-kpi">
          <i className="ti ti-calendar clm-kpi-icon" aria-hidden="true" />
          <div>
            <div className="clm-kpi-num" style={{ fontSize: '1rem' }}>{renewals[0] ? fmtDate(renewals[0]) : '—'}</div>
            <div className="clm-kpi-label">Earliest renewal</div>
          </div>
        </div>
        <div className="clm-kpi" style={{ marginLeft: 'auto' }}>
          <Link to="/#plans" className="btn primary" style={{ fontSize: '0.82rem', padding: '8px 16px' }}>+ Buy plans</Link>
        </div>
      </div>

      {celebrate && <div className="alert ok celebrate">{celebrate}</div>}
      {err && <div className="alert error">{err}</div>}

      {orders && orders.length === 0 ? (
        <div className="clm-empty">
          <i className="ti ti-certificate" style={{ fontSize: 32, color: '#b4dffc' }} aria-hidden="true" />
          <h3>No certificates yet</h3>
          <p>Purchase a plan and your certificates appear here — ready to activate automation.</p>
          <Link to="/#plans" className="btn primary">Browse plans →</Link>
        </div>
      ) : (
        <div className="clm-table-wrap">
          {/* toolbar */}
          <div className="clm-toolbar">
            <div className="clm-search-wrap">
              <i className="ti ti-search clm-search-icon" aria-hidden="true" />
              <input
                className="clm-search"
                placeholder="Search domain, order #, CA…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              />
            </div>
            <a href="#" className="clm-export-btn" onClick={(e) => {
              e.preventDefault()
              const header = 'Order #,Product,CA,Domain,Status,Renews,Days left'
              const rows = (orders || []).map(o => {
                const d = deliverables(o)
                const dom = d.vendorDomains.map(v => typeof v === 'string' ? v : v?.name || '').filter(Boolean).join('; ')
                const days = d.renewal ? Math.ceil((new Date(d.renewal) - Date.now()) / 86400000) : ''
                const ca = { 300: 'Sectigo', 400: 'RapidSSL', 401: 'RapidSSL', 402: 'GeoTrust', 403: 'GeoTrust' }[o.product_id] || ''
                return [o.gogetssl_order_id, `"${o.product_name}"`, ca, dom || '—', d.activated ? 'Automated' : 'Pending setup', d.renewal || '—', days].join(',')
              })
              const csv = [header, ...rows].join('\n')
              const blob = new Blob([csv], { type: 'text/csv' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url; a.download = 'certificates.csv'; a.click()
              URL.revokeObjectURL(url)
            }}>Export CSV</a>
          </div>

          {/* tab strip */}
          <div className="clm-tabs">
            {tabs.map((t) => (
              <button key={t.id} type="button"
                className={'clm-tab' + (tab === t.id ? ' on' : '') + (t.id === 'action' && t.count > 0 ? ' warn' : '')}
                onClick={() => { setTab(t.id); setPage(0) }}>
                {t.label}
                <span className={'clm-tab-count' + (t.id === 'action' && t.count > 0 ? ' warn' : '')}>{t.count}</span>
              </button>
            ))}
          </div>

          {/* table */}
          <table className="clm-table">
            <colgroup>
              <col /><col /><col /><col /><col /><col />
            </colgroup>
            <thead>
              <tr>
                <th onClick={() => toggleSort('name')}>Certificate / Domain <SortIcon col="name" /></th>
                <th onClick={() => toggleSort('ca')}>CA <SortIcon col="ca" /></th>
                <th onClick={() => toggleSort('status')}>Status <SortIcon col="status" /></th>
                <th onClick={() => toggleSort('renewal')}>Renews <SortIcon col="renewal" /></th>
                <th>Lifecycle</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td colSpan={6} className="clm-empty-row">No certificates match your search or filter.</td></tr>
              )}
              {pageRows.map((o) => {
                const d = deliverables(o)
                const days = daysUntil(d.renewal)
                const pct = days != null ? Math.min(100, Math.max(0, Math.round((365 - days) / 365 * 100))) : 0
                const barColor = d.activated ? '#3375b1' : days != null && days < 60 ? '#e24b4a' : '#f0a020'
                const isOpen = open === o.id
                const domainList = d.vendorDomains.map((x) => typeof x === 'string' ? x : x?.name || '').filter(Boolean)

                return (
                  <React.Fragment key={o.id}>
                    <tr className={'clm-row' + (isOpen ? ' open' : '') + (d.activated ? ' ok' : '')}
                      onClick={() => openRow(o)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div className="clm-row-top">
                          <span className="clm-cert-name">{o.product_name}</span>
                          <span className={'clm-method-badge ' + (d.isAcme ? 'clm-method-acme' : 'clm-method-agent')}>{d.isAcme ? 'ACME' : 'Agent'}</span>
                        </div>
                        <div className="clm-cert-meta">
                          <span className="clm-meta-id">#{o.gogetssl_order_id}</span>
                          <span className="clm-meta-sep">·</span>
                          {domainList.length > 0
                            ? <span className="clm-domain">{domainList[0]}{domainList.length > 1 ? ` +${domainList.length - 1}` : ''}</span>
                            : <span className="clm-no-domain">no domain yet</span>
                          }
                        </div>
                      </td>
                      <td>
                        <div className="clm-ca">
                          <span className="clm-ca-dot" style={{ background: caColors[o.product_id] || '#888' }} />
                          {caLabels[o.product_id] || 'CA'}
                        </div>
                      </td>
                      <td>
                        {d.activated
                          ? <span className="clm-status-pill ok">Automated ✓</span>
                          : (() => {
                              let step, label
                              if (d.isAcme) { step = d.enrollReady ? 3 : 2; label = d.enrollReady ? 'Configure ACME' : 'Provisioning' }
                              else { step = !d.agentInstalled ? 2 : 3; label = !d.agentInstalled ? 'Install agent' : 'Add domain' }
                              return (
                                <span className="clm-step-pill">
                                  <span className="clm-step-num">{step}/4</span>
                                  {label}
                                </span>
                              )
                            })()
                        }
                      </td>
                      <td>
                        <div className="clm-renew">{d.renewal ? fmtDate(d.renewal) : '—'}</div>
                        {days != null && <div className="clm-days">{days}d left</div>}
                      </td>
                      <td>
                        <div className="clm-bar"><div className="clm-bar-fill" style={{ width: pct + '%', background: barColor }} /></div>
                        <div className="clm-bar-label">Year 1</div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()} className="clm-action-cell">
                        <div className="clm-action-row">
                          {d.activated ? (
                            <button type="button" className="clm-act-ghost" disabled={checking === o.id} onClick={() => checkNow(o)}>
                              {checking === o.id ? '…' : '⟳ Sync'}
                            </button>
                          ) : d.isAcme ? (
                            <>
                              {d.enrollReady && d.acme
                                ? <a className="clm-act-primary" href="#" onClick={(e) => { e.preventDefault(); openRow(o) }}>View credentials</a>
                                : <span className="clm-act-muted">Provisioning…</span>
                              }
                              <button type="button" className="clm-act-ghost" disabled={checking === o.id} onClick={() => checkNow(o)}>{checking === o.id ? '…' : '⟳'}</button>
                            </>
                          ) : (
                            <>
                              {d.setupLink
                                ? <a className="clm-act-primary" href={d.setupLink} target="_blank" rel="noreferrer">Setup portal</a>
                                : <span className="clm-act-muted">Loading…</span>
                              }
                              <button type="button" className="clm-act-ghost" disabled={checking === o.id} onClick={() => checkNow(o)}>{checking === o.id ? '…' : '⟳'}</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="clm-expand-row">
                        <td colSpan={6}>
                          <div className="clm-expand-body">
                            <PlanCard order={o} isReseller={false} servers={servers} noHead
                              onAssignServer={async (id, sid) => {
                                await supabase.from('orders').update({ server_id: sid || null }).eq('id', id)
                                load()
                              }}
                              onCheck={checkNow} checking={checking === o.id} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>

          {/* pagination */}
          {totalPages > 1 && (
            <div className="clm-pagination">
              <span className="clm-pg-info">
                Showing {page * PAGE + 1}–{Math.min((page + 1) * PAGE, filtered.length)} of {filtered.length} certificates
              </span>
              <div className="clm-pg-btns">
                <button type="button" className="clm-pg-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>←</button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button key={i} type="button" className={'clm-pg-btn' + (i === page ? ' on' : '')} onClick={() => setPage(i)}>{i + 1}</button>
                ))}
                <button type="button" className="clm-pg-btn" disabled={page === totalPages - 1} onClick={() => setPage(p => p + 1)}>→</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- reseller: Sectigo CaaS multi-domain management ----------

function CaasInline({ order, onChanged }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const d = deliverables(order)

  async function addDomain() {
    const v = value.trim().toLowerCase()
    if (!v) return
    if (!confirm(`Add ${v} to CaaS subscription #${order.gogetssl_order_id}?\n\nThe CA bills this pro-rated to the subscription's renewal date.`)) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
        body: JSON.stringify({ order_id: order.id, domain: v }),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.message || 'Domain addition failed.')
      setMsg(`${body.added} added — domains and credentials re-synced from the CA.`)
      setValue('')
      onChanged()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="caas-tag-editor">
      <div className="caas-tag-row">
        <span className="caas-tag-label">🔒 Domains</span>
        {d.vendorDomains.length === 0 && <span className="caas-empty-tag">no domains yet</span>}
        {d.vendorDomains.map((dom) => {
          const name = typeof dom === 'string' ? dom : dom?.name || ''
          return <span className="caas-tag" key={name}>{name}</span>
        })}
        <div className="caas-add-pill">
          <input className="caas-add-input" placeholder="add domain…" value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDomain())} />
          <button type="button" className="caas-add-btn" disabled={busy} onClick={addDomain}>
            {busy ? '…' : '+ Add'}
          </button>
        </div>
      </div>
      {msg && <p className="caas-feedback ok">{msg}</p>}
      {err && <p className="caas-feedback err">{err}</p>}
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
  const [open, setOpen] = useState({})
  const [filter, setFilter] = useState('all')

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

  const customerName = (o) =>
    o.user_id === session.user.id ? 'You' : (subs.find((c) => c.id === o.user_id)?.full_name || 'Customer')

  const rows = (allOrders || []).filter((o) => {
    if (filter === 'inventory') return o.user_id === session.user.id && !o.assigned_at
    if (filter === 'assigned') return o.user_id !== session.user.id
    if (filter === 'attention') return !deliverables(o).activated
    return true
  })

  const filters = [
    ['all', `All · ${(allOrders || []).length}`],
    ['inventory', `Inventory · ${inventory.length}`],
    ['assigned', `Customers · ${assigned.length + subOrders.filter((o) => !o.assigned_by).length}`],
    ['attention', `Needs attention · ${(allOrders || []).filter((o) => !deliverables(o).activated).length}`],
  ]

  // Customer-view state
  const [selCustomer, setSelCustomer] = useState('__all__') // '__all__' | '__mine__' | customer.id

  const caLabels = { 300: 'Sectigo', 400: 'RapidSSL', 401: 'RapidSSL', 402: 'GeoTrust', 403: 'GeoTrust' }
  const caColors = { 300: '#b8001a', 400: '#1a6bb5', 401: '#1a6bb5', 402: '#c26a00', 403: '#c26a00' }

  // Rows shown in the right panel
  const visibleRows = (() => {
    if (!allOrders) return []
    if (selCustomer === '__all__') return rows
    if (selCustomer === '__mine__') return (own || []).filter(o => !o.assigned_at)
    return allOrders.filter(o => o.user_id === selCustomer)
  })()

  // Customer list for sidebar: "All", "Inventory (mine)", then each sub
  const custList = [
    { id: '__all__',  label: 'All subscriptions', count: (allOrders || []).length, icon: '▦' },
    { id: '__mine__', label: 'My inventory',       count: inventory.length,         icon: '📦' },
    ...subs.map(c => ({
      id: c.id,
      label: c.full_name || 'Customer',
      count: allOrders ? allOrders.filter(o => o.user_id === c.id).length : 0,
      pending: allOrders ? allOrders.filter(o => o.user_id === c.id && !deliverables(o).activated).length : 0,
      icon: '👤',
    })),
  ]

  function OrderTable({ orderList }) {
    if (!orderList || orderList.length === 0)
      return <div className="rd-empty"><i className="ti ti-inbox" style={{fontSize:28,color:'#b4dffc'}} aria-hidden="true"/><p>No subscriptions here.</p></div>
    return (
      <div className="rd-order-table">
        <div className="rd-tbl-head">
          <span>Order #</span><span>Product</span>
          {selCustomer === '__all__' && <span>Customer</span>}
          <span>Status</span><span>Renews</span><span/>
        </div>
        {orderList.map(o => {
          const d = deliverables(o)
          const mine = o.user_id === session.user.id && !o.assigned_at
          const isOpen = !!open[o.id]
          return (
            <div className={'rd-order-row' + (isOpen ? ' open' : '')} key={o.id}>
              <button type="button" className={'rd-tbl-row' + (selCustomer === '__all__' ? ' wide' : '')} onClick={() => {
                const opening = !isOpen
                setOpen(x => ({ ...x, [o.id]: !x[o.id] }))
                if (opening) refreshOrders([o]).then(r => r && load())
              }} aria-expanded={isOpen}>
                <span className="rd-order-id">#{o.gogetssl_order_id}</span>
                <span className="rd-order-product">
                  <span className="rd-ca-dot" style={{background: caColors[o.product_id]||'#888'}}/>
                  <span>{o.product_name}</span>
                </span>
                {selCustomer === '__all__' && (
                  <span className="rd-order-cust">{customerName(o)}{o.assigned_at && ' 🔒'}</span>
                )}
                <span><StagePill d={d}/></span>
                <span className="rd-order-renew">{d.renewal ? fmtDate(d.renewal) : '—'}</span>
                <span className="chev">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="sub-row-body">
                  {mine ? (
                    <PlanCard order={o} isReseller servers={servers} noHead
                      onAssignServer={assignServer} onCheck={checkNow} checking={checking === o.id}>
                      {Number(o.product_id) === 300 && <CaasInline order={o} onChanged={load}/>}
                      {subs.length > 0 && (
                        <div className="assign-row">
                          <span className="assign-label">Assign to customer</span>
                          <select value={assignTo[o.id]||''} onChange={e => setAssignTo({...assignTo,[o.id]:e.target.value})}>
                            <option value="">— choose customer —</option>
                            {subs.map(c => <option key={c.id} value={c.id}>{c.full_name||c.id.slice(0,8)}</option>)}
                          </select>
                          <button className="btn primary" type="button" disabled={!assignTo[o.id]||busyAssign===o.id} onClick={()=>assign(o)}>
                            {busyAssign===o.id?'Assigning…':'Assign permanently →'}
                          </button>
                          <p className="assign-warn">⚠ Assignment is permanent and cannot be undone.</p>
                        </div>
                      )}
                    </PlanCard>
                  ) : (
                    <div className="cust-detail">
                      <p className="muted-line">
                        {o.assigned_at?'Permanently assigned to ':'Purchased by '}<b>{customerName(o)}</b>
                        {o.assigned_at?' — locked, cannot be reassigned.':'.'}
                        {' '}CA status: <StatusVal value={d.activated?'activated':'pending setup'}/>
                      </p>
                      {Number(o.product_id)===300 && <CaasInline order={o} onChanged={load}/>}
                      <button className="btn ghost" type="button" disabled={checking===o.id} onClick={()=>checkNow(o)}>
                        {checking===o.id?'Checking…':'⟳ Re-sync from CA'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const selInfo = custList.find(c => c.id === selCustomer)

  return (
    <div className="dash-page">
      <span className="eyebrow">Reseller dashboard</span>
      <h1>{profile?.full_name ? `${profile.full_name.split(' ')[0]}'s business` : 'Your business'}</h1>

      {/* KPI strip */}
      <div className="r-kpi-strip">
        <button type="button" className={'r-kpi'+(selCustomer==='__mine__'?' accent':'')} onClick={()=>setSelCustomer('__mine__')}>
          <span className="r-kpi-num">{own ? inventory.length : '—'}</span>
          <span className="r-kpi-label">Inventory</span>
          <span className="r-kpi-sub">unassigned plans</span>
        </button>
        <button type="button" className={'r-kpi'+(filter==='assigned'?' accent':'')} onClick={()=>{setFilter('assigned');setSelCustomer('__all__')}}>
          <span className="r-kpi-num">{assigned.length}</span>
          <span className="r-kpi-label">Assigned</span>
          <span className="r-kpi-sub">to customers</span>
        </button>
        <button type="button" className={'r-kpi'+(filter==='attention'?' accent':'')} onClick={()=>{setFilter('attention');setSelCustomer('__all__')}}>
          <span className="r-kpi-num">{(allOrders||[]).filter(o=>!deliverables(o).activated).length}</span>
          <span className="r-kpi-label">Needs attention</span>
          <span className="r-kpi-sub">not yet automated</span>
        </button>
        <button type="button" className="r-kpi" onClick={()=>{setSelCustomer('__all__');setFilter('all')}}>
          <span className="r-kpi-num">{subs.length}</span>
          <span className="r-kpi-label">Customers</span>
          <span className="r-kpi-sub">{subServers.length} server{subServers.length!==1?'s':''} · {subDomains.length} domain{subDomains.length!==1?'s':''}</span>
        </button>
      </div>

      {celebrate && <div className="alert ok celebrate">{celebrate}</div>}
      {err && <div className="alert error">{err}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      {/* Two-panel layout */}
      <div className="rd-layout">

        {/* Left: customer list */}
        <div className="rd-sidebar">
          <div className="rd-sidebar-head">
            <span className="rd-sidebar-title">Accounts</span>
            <Link to="/#plans" className="rd-sidebar-buy">+ Buy</Link>
          </div>
          <div className="rd-customer-list">
            {custList.map(c => (
              <div key={c.id} className={'rd-cust-item'+(selCustomer===c.id?' active':'')}>
                <button type="button" className="rd-cust-row-btn"
                  onClick={()=>{setSelCustomer(c.id);setFilter('all')}}>
                  <span className="rd-cust-icon">{c.icon}</span>
                  <span className="rd-cust-label">{c.label}</span>
                  <span className="rd-cust-badges">
                    {c.pending>0 && <span className="rd-cust-badge warn">{c.pending}</span>}
                    <span className="rd-cust-badge">{c.count}</span>
                  </span>
                </button>
                {c.id !== '__all__' && c.id !== '__mine__' && (
                  <Link to={`/order-for/${c.id}`} className="rd-cust-buy" title={`Buy a plan for ${c.label}`}>+</Link>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: orders panel */}
        <div className="rd-main">
          <div className="rd-main-head">
            <div>
              <div className="rd-main-title">{selInfo?.label || 'Subscriptions'}</div>
              <div className="rd-main-sub">{selInfo?.count ?? 0} subscription{selInfo?.count!==1?'s':''}{selInfo?.pending>0 ? ` · ${selInfo.pending} need action` : ''}</div>
            </div>
            {selCustomer !== '__all__' && selCustomer !== '__mine__' && (
              <div className="rd-main-actions">
                <span className="rd-main-stat ok">{allOrders?.filter(o=>o.user_id===selCustomer&&deliverables(o).activated).length||0} automated</span>
                <span className="rd-main-stat warn">{allOrders?.filter(o=>o.user_id===selCustomer&&!deliverables(o).activated).length||0} pending</span>
              </div>
            )}
          </div>

          {selCustomer === '__all__' && (
            <div className="rd-filter-bar">
              {filters.map(([key,label]) => (
                <button key={key} type="button" className={'filter-chip'+(filter===key?' on':'')} onClick={()=>setFilter(key)}>{label}</button>
              ))}
            </div>
          )}

          <OrderTable orderList={visibleRows} />
        </div>
      </div>
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
