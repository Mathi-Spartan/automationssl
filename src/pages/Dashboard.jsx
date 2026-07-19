import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as XLSX from 'xlsx'

/* ── Excel export utility ── */
function buildXLSX(rows, filename, sheetName = 'Orders') {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  // Column widths
  ws['!cols'] = [
    { wch: 12 }, { wch: 38 }, { wch: 14 }, { wch: 20 },
    { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 10 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

const CA_LABELS = { 300: 'Sectigo', 400: 'RapidSSL', 401: 'RapidSSL', 402: 'GeoTrust', 403: 'GeoTrust' }

function ordersToRows(orders, includeCustomer = true, customerName = null) {
  const header = ['Order #', 'Product', 'CA', ...(includeCustomer ? ['Customer'] : []), 'Domain(s)', 'Status', 'Renews', 'Days left']
  const rows = (orders || []).map(o => {
    const d = deliverables(o)
    const dom = d.vendorDomains.map(v => typeof v === 'string' ? v : v?.name || '').filter(Boolean).join('; ') || '—'
    const days = d.renewal ? Math.ceil((new Date(d.renewal) - Date.now()) / 86400000) : ''
    const status = d.activated ? 'Automated' : 'Pending setup'
    const renews = d.renewal || '—'
    const ca = CA_LABELS[o.product_id] || ''
    const cust = customerName || o.customer_name || '—'
    return [o.gogetssl_order_id, o.product_name, ca, ...(includeCustomer ? [cust] : []), dom, status, renews, days]
  })
  return [header, ...rows]
}

import { Link, Navigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import Customers from './Customers.jsx'

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
    // What the customer has actually done, as opposed to what the product
    // family allows. +Automate plans support BOTH agent and ACME, so until a
    // method is used we must not claim one. null = not yet chosen.
    methodUsed: isAcme
      ? 'acme'
      : (item?.autoinstall?.installation_method || (aiStatus && aiStatus !== 'incomplete') ? 'agent' : null),
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

const ACME_CLIENTS = [
  {
    key: 'certbot', label: 'certbot',
    note: 'Registers the account. Issue certificates afterwards with certbot certonly.',
    build: (a) => `certbot register \\
  --server ${a.server_url} \\
  --eab-kid ${a.eab_kid} \\
  --eab-hmac-key ${a.eab_hmac_key}`,
  },
  {
    key: 'acmesh', label: 'acme.sh',
    note: 'Registers the account against this CA. Then issue with acme.sh --issue.',
    build: (a) => `acme.sh --register-account \\
  --server ${a.server_url} \\
  --eab-kid ${a.eab_kid} \\
  --eab-hmac-key ${a.eab_hmac_key}`,
  },
  {
    key: 'caddy', label: 'Caddy',
    note: 'Add to the global options block of your Caddyfile. Caddy issues and renews on its own.',
    build: (a) => `{
  acme_ca ${a.server_url}
  acme_eab {
    key_id  ${a.eab_kid}
    mac_key ${a.eab_hmac_key}
  }
}`,
  },
  {
    key: 'lego', label: 'lego',
    note: 'Single run — registers and issues together. Replace the email with your own.',
    build: (a, dom) => `lego --server ${a.server_url} \\
  --eab --kid ${a.eab_kid} \\
  --hmac ${a.eab_hmac_key} \\
  --domains ${dom || 'example.com'} \\
  --email you@example.com run`,
  },
  {
    key: 'certmgr', label: 'cert-manager',
    note: 'Create the secret first, then apply the issuer — Kubernetes reads the HMAC from the secret, not inline.',
    build: (a) => `kubectl create secret generic sectigo-eab \\
  --namespace cert-manager \\
  --from-literal=secret='${a.eab_hmac_key}'

# then apply:
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: sectigo
spec:
  acme:
    server: ${a.server_url}
    privateKeySecretRef:
      name: sectigo-account-key
    externalAccountBinding:
      keyID: ${a.eab_kid}
      keySecretRef:
        name: sectigo-eab
        key: secret`,
  },
]

function AcmeClients({ acme, domain }) {
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState('certbot')
  const client = ACME_CLIENTS.find((c) => c.key === pick) || ACME_CLIENTS[0]
  const cmd = client.build(acme, domain)
  const panelId = 'acme-panel-' + (acme?.eab_kid || 'x')

  if (!open) {
    return (
      <button type="button" className="acme-toggle" aria-expanded="false" aria-controls={panelId}
        onClick={() => setOpen(true)}>
        <i className="ti ti-terminal-2" aria-hidden="true" />
        <span className="acme-toggle-t">Show setup instructions</span>
        <span className="acme-toggle-n">certbot · acme.sh · Caddy · lego · cert-manager</span>
        <i className="ti ti-chevron-down acme-toggle-c" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className="cred-card cmd acme-clients" id={panelId}>
      <div className="acme-clients-head">
        <span className="acme-clients-title">Register your ACME client</span>
        <button type="button" className="acme-hide" aria-expanded="true" aria-controls={panelId}
          onClick={() => setOpen(false)}>Hide</button>
      </div>
      <div className="acme-tabs" role="tablist" aria-label="ACME client">
        {ACME_CLIENTS.map((c) => (
          <button key={c.key} type="button" role="tab" aria-selected={c.key === pick}
            className={'acme-tab' + (c.key === pick ? ' on' : '')}
            onClick={() => setPick(c.key)}>{c.label}</button>
        ))}
      </div>
      <div className="acme-panel">
        <div className="acme-panel-top">
          <span className="acme-note">{client.note}</span>
          <CopyBtn label="Copy" text={cmd} />
        </div>
        <pre className="acme-creds">{cmd}</pre>
      </div>
    </div>
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

function StagePill({ d }) {
  if (d.activated) return <span className="stage-pill ok">Automated ✓</span>
  if (d.isAcme) {
    return d.enrollReady
      ? <span className="stage-pill warn">Configure ACME client</span>
      : <span className="stage-pill warn">Enrollment provisioning</span>
  }
  // Until a method is used, +Automate customers can take either route.
  const label = d.agentInstalled ? 'Add your domain' : 'Install agent or ACME'
  return <span className="stage-pill warn">{label}</span>
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

      <div className={'pc-cols' + (d.isAcme ? '' : ' pc-cols-flat')}>
        <aside className="pc-rail">
          <div className="pc-rail-actions">
            {d.setupLink && (
              <a className="btn primary" href={d.setupLink} target="_blank" rel="noreferrer">
                {d.activated ? 'Open automation portal →' : 'Activate — open setup portal →'}
              </a>
            )}
            {!d.activated && onCheck && (
              <button className="btn ghost" type="button" disabled={checking} onClick={() => onCheck(order)}>
                {checking ? 'Checking…' : '⟳ Check status with the CA'}
              </button>
            )}
          </div>

          <dl className="pc-facts">
            {!noHead && <div className="pc-fact"><dt>Order</dt><dd className="mono-v">#{order.gogetssl_order_id}</dd></div>}
            {d.begin && <div className="pc-fact"><dt>Began</dt><dd>{fmtDate(d.begin)}</dd></div>}
            {d.renewal && <div className="pc-fact"><dt>Renews</dt><dd>{fmtDate(d.renewal)}{days != null && <span className="pc-fact-sub"> ({days}d)</span>}</dd></div>}
            {d.caOrderStatus && <div className="pc-fact"><dt>CA order</dt><dd><StatusVal value={d.caOrderStatus} /></dd></div>}
            {d.isAcme && d.acmeAccountStatus && <div className="pc-fact"><dt>ACME</dt><dd><StatusVal value={d.acmeAccountStatus} /></dd></div>}
            {d.aiStatus && <div className="pc-fact"><dt>AutoInstall</dt><dd><StatusVal value={d.aiStatus} /></dd></div>}
            {servers && (
              <div className="pc-fact"><dt>Server</dt><dd>
                <select id={'srv-' + order.id} value={order.server_id || ''} onChange={(e) => onAssignServer(order.id, e.target.value)}>
                  <option value="">— not assigned —</option>
                  {servers.map((sv) => (<option key={sv.id} value={sv.id}>{sv.name} ({sv.environment})</option>))}
                </select>
              </dd></div>
            )}
          </dl>

          {d.vendorDomains.length > 0 && (
            <div className="pc-rail-domains">
              <div className="pc-rail-label">Domains</div>
              <div className="chips">
                {d.vendorDomains.map((dom) => {
                  const name = typeof dom === 'string' ? dom : dom?.name || dom?.domain || ''
                  return d.activated
                    ? <span className="chip lock" key={name} title="Secured — certificate active">🔒 {name}</span>
                    : <span className="chip" key={name} title="Registered with the CA — no certificate issued yet">{name} · awaiting cert</span>
                })}
              </div>
              {d.isAcme && !isReseller && (
                <p className="pc-rail-hint">Extra domains are added by your provider, pro-rated.</p>
              )}
            </div>
          )}

          {order.last_synced_at && (
            <p className="pc-rail-sync">⟳ Synced {fmtTime(order.last_synced_at)}</p>
          )}
        </aside>

        <div className="pc-main">
          {d.activated ? (
            <p className="plan-note ok-note">
              🎉 <b>Automation is live.</b> Issuance and renewals are hands-off from here
              {d.renewal && <> — covered until <b>{fmtDate(d.renewal)}</b>{days != null && <> ({days} days), renews automatically</>}</>}.
            </p>
          ) : d.isAcme ? (
            <p className="plan-note">
              {d.enrollReady ? (
                <><b>Your credentials are ready.</b> Register your ACME client below, then request the certificate for your domain — reissues run on their own after that.</>
              ) : (
                <><b>The CA is provisioning your enrollment — usually a few minutes.</b>{' '}
                Use "Check status with the CA", or just wait: this page re-checks automatically.</>
              )}
            </p>
          ) : (
            <p className="plan-note">
              <b>You're {d.agentInstalled ? '1 step' : 'about 5 minutes'} away.</b>{' '}
              {d.agentInstalled
                ? 'Add the domain you want secured — we\'ll detect it automatically.'
                : 'Open your setup portal, run the one-line install command on your server, then add your domain.'}
            </p>
          )}

        {d.isAcme && d.enrollReady && !d.activated && (
          <div className="pc-creds">
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
            <AcmeClients acme={d.acme} domain={
              (d.vendorDomains?.[0] && (typeof d.vendorDomains[0] === 'string' ? d.vendorDomains[0] : d.vendorDomains[0]?.name)) || order.domain
            } />
          </div>
        )}
        </div>
      </div>

      {d.acme && d.activated && (
        <details style={{ marginTop: 10 }}>
          <summary><strong>ACME enrollment credentials</strong> — works with certbot, acme.sh, Caddy…</summary>
          <pre>{JSON.stringify(d.acme, null, 2)}</pre>
        </details>
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
  const [tlsResults, setTlsResults] = useState({})
  const [tlsChecking, setTlsChecking] = useState(null)

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

  async function checkTLS(order) {
    const d = deliverables(order)
    const dom = d.vendorDomains.map(v => typeof v === 'string' ? v : v?.name || '').filter(Boolean)[0]
    if (!dom) return
    setTlsChecking(order.id)
    try {
      const r = await fetch('/api/tlscheck?domain=' + encodeURIComponent(dom))
      const body = await r.json()
      setTlsResults(x => ({ ...x, [order.id]: body }))
    } catch (_e) {
      setTlsResults(x => ({ ...x, [order.id]: { ok: false, error: 'Network error' } }))
    }
    setTlsChecking(null)
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
              buildXLSX(ordersToRows(orders, false), 'my-certificates.xlsx', 'Certificates')
            }}>
              <i className="ti ti-file-spreadsheet" style={{fontSize:13,verticalAlign:-1,marginRight:4}} aria-hidden="true"/>
              Export Excel
            </a>
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
                          <span className={'clm-method-badge ' + (d.methodUsed === 'acme' ? 'clm-method-acme' : d.methodUsed === 'agent' ? 'clm-method-agent' : 'clm-method-either')}
                            title={d.methodUsed ? undefined : 'This plan works with either method — the customer picks when they set it up'}>
                            {d.methodUsed === 'acme' ? 'ACME' : d.methodUsed === 'agent' ? 'Agent' : 'Agent or ACME'}
                          </span>
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
                              else { step = !d.agentInstalled ? 2 : 3; label = !d.agentInstalled ? 'Install agent or ACME' : 'Add domain' }
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
                            <>
                              <button type="button" className="clm-act-ghost" disabled={checking === o.id} onClick={() => checkNow(o)}>
                                {checking === o.id ? '…' : '⟳'}
                              </button>
                              {deliverables(o).vendorDomains.length > 0 && (
                                <button type="button"
                                  className={'clm-act-tls' + (tlsResults[o.id] ? (tlsResults[o.id].ok && !tlsResults[o.id].expired ? ' tls-ok' : ' tls-warn') : '')}
                                  disabled={tlsChecking === o.id}
                                  title="Live TLS check" onClick={() => checkTLS(o)}>
                                  {tlsChecking === o.id ? '…' : '🔍 TLS'}
                                </button>
                              )}
                            </>
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
                            {tlsResults[o.id] && (
                              <div className={'clm-tls-result' + (tlsResults[o.id].ok && !tlsResults[o.id].expired ? ' tls-ok' : ' tls-warn')}>
                                {tlsResults[o.id].ok ? (<>
                                  <span className="clm-tls-icon">{tlsResults[o.id].expired ? '⚠' : tlsResults[o.id].expiringSoon ? '⚡' : '✓'}</span>
                                  <div className="clm-tls-body">
                                    <div className="clm-tls-title">{tlsResults[o.id].expired ? 'Certificate expired on domain' : tlsResults[o.id].expiringSoon ? `Expiring soon — ${tlsResults[o.id].daysLeft} days left` : `Certificate valid · ${tlsResults[o.id].daysLeft} days remaining`}</div>
                                    <div className="clm-tls-meta">Issuer: {tlsResults[o.id].issuer} · Expires: {new Date(tlsResults[o.id].validTo).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
                                  </div>
                                </>) : (<>
                                  <span className="clm-tls-icon">✗</span>
                                  <div className="clm-tls-body">
                                    <div className="clm-tls-title">TLS probe failed — cert may not be installed yet</div>
                                    <div className="clm-tls-meta">{tlsResults[o.id].error}</div>
                                  </div>
                                </>)}
                              </div>
                            )}
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
          return (
            <span className="caas-tag" key={name}>
              {name}
              <button type="button" className="caas-tag-rm" title={`Remove ${name}`} onClick={async () => {
                if (!confirm(`Remove ${name} from CaaS #${order.gogetssl_order_id}?`)) return
                setBusy(true); setErr(null); setMsg(null)
                try {
                  const { data: sess } = await supabase.auth.getSession()
                  const res = await fetch('/api/domains', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
                    body: JSON.stringify({ order_id: order.id, domain: name }),
                  })
                  const body = await res.json()
                  if (!res.ok || body.error) throw new Error(body.message || 'Removal failed.')
                  setMsg(`${name} removed.`)
                  onChanged()
                } catch (e) { setErr(e.message) } finally { setBusy(false) }
              }}>×</button>
            </span>
          )
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

/* ── Export dropdown ── */
function ExportDropdown({ rows, custLabel, inclCust, custName }) {
  const [open, setOpen] = React.useState(false)
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const ref = React.useRef(null)
  React.useEffect(() => {
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  function run(label, fromDate, toDate) {
    const filtered = fromDate ? rows.filter(o => {
      const d = new Date(o.created_at)
      return d >= fromDate && d <= toDate
    }) : rows
    if (!filtered.length) { alert('No orders in this date range.'); return }
    buildXLSX(ordersToRows(filtered, inclCust, custName), `orders-${custLabel}-${label}.xlsx`, 'Orders')
    setOpen(false)
  }
  const presets = [
    ['Today', 0, 'ti-calendar-event'],
    ['Last 7 days', 7, 'ti-calendar-week'],
    ['Last 30 days', 30, 'ti-calendar-month'],
    ['Last 90 days', 90, 'ti-calendar-stats'],
    ['Last 6 months', 180, 'ti-calendar'],
    ['Last 12 months', 365, 'ti-calendar'],
  ]
  return (
    <div className="export-wrap" ref={ref}>
      <button type="button" className="clm-export-btn" onClick={() => setOpen(o => !o)}>
        <i className="ti ti-download" style={{fontSize:13,verticalAlign:-1,marginRight:4}} aria-hidden="true"/>
        Export <i className="ti ti-chevron-down" style={{fontSize:11,verticalAlign:-1,marginLeft:2}} aria-hidden="true"/>
      </button>
      {open && (
        <div className="export-panel">
          <div className="export-panel-head">Quick range</div>
          {presets.map(([label, days, icon]) => (
            <button key={label} type="button" className="export-preset" onClick={() => {
              const t = new Date(); t.setHours(23,59,59,999)
              const f = new Date(); f.setDate(f.getDate() - days); f.setHours(0,0,0,0)
              run(label.toLowerCase().replace(/\s+/g,'-'), f, t)
            }}>
              <i className={'ti ' + icon} style={{fontSize:13,color:'#3375b1',flexShrink:0}} aria-hidden="true"/>
              {label}
            </button>
          ))}
          <button type="button" className="export-preset" onClick={() => run('all', null, null)}>
            <i className="ti ti-infinity" style={{fontSize:13,color:'#3375b1',flexShrink:0}} aria-hidden="true"/>
            All time
          </button>
          <div className="export-divider"/>
          <div className="export-custom">
            <div className="export-panel-head" style={{padding:'0 0 3px'}}>Custom range</div>
            <div className="export-custom-row">
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}/>
            </div>
            <div className="export-custom-row">
              <input type="date" value={to} onChange={e => setTo(e.target.value)}/>
            </div>
            <button type="button" className="btn primary" style={{fontSize:'0.75rem',padding:'5px 0',width:'100%',marginTop:2}}
              disabled={!from||!to} onClick={() => {
                const f=new Date(from); f.setHours(0,0,0,0)
                const t=new Date(to); t.setHours(23,59,59,999)
                if(f>t){alert('Start must be before end date.');return}
                run(`${from}-to-${to}`, f, t)
              }}>
              <i className="ti ti-download" style={{fontSize:12,marginRight:4}} aria-hidden="true"/>
              Export range
            </button>
          </div>
        </div>
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
  const [open, setOpen] = useState({})
  const [filter, setFilter] = useState('all')
  const [balance, setBalance] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [cancelErr, setCancelErr] = useState(null)

  const load = useCallback(async () => {
    const uid = session.user.id
    const [o, so, p, s, ss, sd] = await Promise.all([
      supabase.from('orders').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
      supabase.from('orders').select('*').neq('user_id', uid).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, customer_code, account_type').eq('parent_reseller_id', uid).order('created_at'),
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data?.session?.access_token) return
      fetch('/api/balance', { headers: { Authorization: `Bearer ${data.session.access_token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.ok) setBalance({ amount: d.balance, currency: d.currency }) })
        .catch(() => {})
    })
  }, [])

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

  async function checkTLS(order) {
    const d = deliverables(order)
    const dom = d.vendorDomains.map(v => typeof v === 'string' ? v : v?.name || '').filter(Boolean)[0]
    if (!dom) return
    setTlsChecking(order.id)
    try {
      const r = await fetch('/api/tlscheck?domain=' + encodeURIComponent(dom))
      const body = await r.json()
      setTlsResults(x => ({ ...x, [order.id]: body }))
    } catch (_e) {
      setTlsResults(x => ({ ...x, [order.id]: { ok: false, error: 'Network error' } }))
    }
    setTlsChecking(null)
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
  const [custSearch, setCustSearch] = useState('')

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
  const initialsOf = (name) => (name || 'C').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const daysSince = (ts) => ts ? Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)) : null
  const custList = [
    { id: '__all__',  label: 'All subscriptions', count: (allOrders || []).length },
    { id: '__mine__', label: 'My inventory',       count: inventory.length },
    ...subs.map(c => {
      const theirs = allOrders ? allOrders.filter(o => o.user_id === c.id) : []
      const pendingOrders = theirs.filter(o => !deliverables(o).activated)
      const oldestDays = pendingOrders.length
        ? Math.max(...pendingOrders.map(o => daysSince(o.assigned_at || o.created_at) ?? 0))
        : null
      return {
        id: c.id,
        label: c.full_name || 'Customer',
        code: c.customer_code || null,
        initials: initialsOf(c.full_name),
        count: theirs.length,
        pending: pendingOrders.length,
        automated: theirs.length - pendingOrders.length,
        oldestDays,
      }
    }),
  ]

  function OrderTable({ orderList }) {
    if (!orderList || orderList.length === 0)
      return <div className="rd-empty"><i className="ti ti-inbox" style={{fontSize:28,color:'#b4dffc'}} aria-hidden="true"/><p>No subscriptions here.</p></div>
    const wide = selCustomer === '__all__'
    return (
      <div className="rd-order-table">
        <div className={'rd-tbl-head rd-tbl-head-v2' + (wide ? ' wide' : '')}>
          <span>Date</span>
          <span>Order ID / Domain</span>
          <span>Product</span>
          {wide && <span>Customer</span>}
          <span>Expires</span>
          <span>Status</span>
          <span style={{textAlign:'right'}}>Actions</span>
        </div>
        {orderList.map(o => {
          const d = deliverables(o)
          const mine = o.user_id === session.user.id && !o.assigned_at
          const isOpen = !!open[o.id]
          const orderedDate = o.created_at ? fmtDate(o.created_at) : '—'
          return (
            <div className={'rd-order-row' + (isOpen ? ' open' : '')} key={o.id}>
              <button type="button" className={'rd-tbl-row-v2' + (wide ? ' wide' : '')} onClick={() => {
                const opening = !isOpen
                setOpen(x => ({ ...x, [o.id]: !x[o.id] }))
                if (opening) refreshOrders([o]).then(r => r && load())
              }} aria-expanded={isOpen}>
                <span className="rd-order-date">{orderedDate}</span>
                <span className="rd-order-id-domain">
                  <span className="rd-order-id" style={{color:'var(--cert)'}}>{o.gogetssl_order_id}</span>
                  <span className="rd-order-domain">{
                    (d.vendorDomains?.[0] && (typeof d.vendorDomains[0]==='string' ? d.vendorDomains[0] : d.vendorDomains[0]?.name))
                    || o.domain
                    || '—'
                  }</span>
                </span>
                <span className="rd-order-product">
                  <span className="rd-ca-dot" style={{background: caColors[o.product_id]||'#888'}}/>
                  <span className="rd-order-product-name">{o.product_name}</span>
                </span>
                {wide && <span className="rd-order-cust">{customerName(o)}{o.assigned_at && <i className="ti ti-lock" style={{fontSize:11,marginLeft:4,verticalAlign:-1}} aria-hidden="true"/>}</span>}
                <span className="rd-order-renew">{d.renewal ? fmtDate(d.renewal) : '—'}</span>
                <span><StagePill d={d}/></span>
                <span className="rd-order-actions" onClick={e => e.stopPropagation()}>
                  <i className={'ti ' + (isOpen ? 'ti-chevron-up' : 'ti-chevron-down')} aria-hidden="true"/>
                  <i className="ti ti-x rd-cancel-icon" aria-hidden="true"
                    onClick={e => { e.stopPropagation(); if(o.status!=='cancelled') cancelOrder(o) }}/>
                </span>
              </button>
              {isOpen && (
                <div className="sub-row-body">
                  {mine ? (
                    <PlanCard order={o} isReseller servers={servers} noHead
                      onAssignServer={assignServer} onCheck={checkNow} checking={checking === o.id}>
                      {Number(o.product_id) === 300 && <CaasInline order={o} onChanged={load}/>}
                      <div className="cancel-row">
                        {cancelErr && cancelling === o.id && <span className="cancel-err">{cancelErr}</span>}
                        <button className="btn ghost danger-btn" type="button"
                          disabled={cancelling === o.id || o.status === 'cancelled'}
                          onClick={() => cancelOrder(o)}>
                          {cancelling === o.id ? 'Cancelling…' : o.status === 'cancelled' ? 'Cancelled' : 'Cancel subscription'}
                        </button>
                      </div>
                      {subs.length > 0 && (
                        <div className="assign-row">
                          <span className="assign-label">Assign to customer</span>
                          <select value={assignTo[o.id]||''} onChange={e => setAssignTo({...assignTo,[o.id]:e.target.value})}>
                            <option value="">— choose customer —</option>
                            {subs.filter(c => c.account_type !== 'reseller').map(c => <option key={c.id} value={c.id}>{c.full_name||c.id.slice(0,8)}</option>)}
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
                      <div className="cust-detail-info">
                        {o.assigned_at ? 'Permanently assigned to ' : 'Purchased by '}
                        <b>{customerName(o)}</b>
                        {o.assigned_at ? ' — locked.' : '.'}{' '}
                        CA status: <StatusVal value={d.activated ? 'activated' : 'pending setup'}/>
                      </div>
                      {Number(o.product_id) === 300 && (
                        <div className="cust-detail-domains">
                          <CaasInline order={o} onChanged={load}/>
                        </div>
                      )}
                      <div className="cust-detail-actions">
                        <button className="btn ghost" type="button" disabled={checking===o.id} onClick={()=>checkNow(o)}>
                          {checking===o.id ? 'Checking…' : '⟳ Re-sync from CA'}
                        </button>
                        {Number(o.product_id) !== 300 && (
                          <button className="btn ghost" type="button" onClick={async () => {
                            const stored = o.api_response?.items?.[0]?.autoinstall?.login_sso_link
                              || o.api_response?.items?.[0]?.autoinstall?.manage_sso_link
                            if (stored) { window.open(stored, '_blank'); return }
                            try {
                              const { data } = await supabase.auth.getSession()
                              const r = await fetch('/api/sso', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
                                body: JSON.stringify({ order_id: o.id }),
                              })
                              const body = await r.json()
                              if (body.sso_link) window.open(body.sso_link, '_blank')
                              else alert('No setup link yet — click ⟳ Re-sync from CA first.')
                            } catch { alert('Could not retrieve the setup link.') }
                          }}>Open setup portal ↗</button>
                        )}
                        <button className="btn ghost danger-btn" type="button"
                          disabled={cancelling === o.id || o.status === 'cancelled'}
                          onClick={() => cancelOrder(o)}>
                          {cancelling === o.id ? 'Cancelling…' : o.status === 'cancelled' ? 'Cancelled' : 'Cancel subscription'}
                        </button>
                        {cancelErr && cancelling === o.id && <span className="cancel-err">{cancelErr}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <div className="rd-tbl-footer">
          <span>{orderList.length} subscription{orderList.length!==1?'s':''}</span>
          <span><i className="ti ti-refresh" style={{fontSize:12,verticalAlign:-2,marginRight:4}} aria-hidden="true"/>Synced from CA</span>
        </div>
      </div>
    )
  }

  async function cancelOrder(order) {
    if (!confirm(`Cancel "${order.product_name}" (#${order.gogetssl_order_id})? This cannot be undone.`)) return
    setCancelling(order.id); setCancelErr(null)
    try {
      const { data } = await supabase.auth.getSession()
      const r = await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ order_id: order.id }),
      })
      const body = await r.json()
      if (!r.ok || body.error) { setCancelErr(body.message || 'Cancellation failed.'); return }
      await load()
    } catch (e) { setCancelErr(String(e.message || e)) }
    finally { setCancelling(null) }
  }

  const selInfo = custList.find(c => c.id === selCustomer)

  return (
    <div className="dash-page">
      <div className="dash-head-row">
        {balance && <div className="reseller-balance">Balance: <strong>{balance.currency} {Number(balance.amount).toFixed(2)}</strong></div>}
        <div>
          <span className="eyebrow">Reseller dashboard</span>
          <h1>{profile?.full_name ? `${profile.full_name.split(' ')[0]}'s business` : 'Your business'}</h1>
        </div>
        <div className="dash-head-buy">
          <Link to="/order-for/stock" className="btn primary">
            <i className="ti ti-shopping-cart" style={{fontSize:14,verticalAlign:-2,marginRight:6}} aria-hidden="true"/>
            Buy now
          </Link>
          <span className="dash-head-hint">buys to your stock — assign to any customer</span>
        </div>
      </div>

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
            <Link to="/dashboard/customers" className="rd-sidebar-add">
              <i className="ti ti-user-plus" style={{fontSize:13,verticalAlign:-2,marginRight:3}} aria-hidden="true"/>Add
            </Link>
          </div>
          <div className="rd-sidebar-search">
            <i className="ti ti-search" aria-hidden="true"/>
            <input type="text" placeholder="Search accounts" value={custSearch}
              onChange={e => setCustSearch(e.target.value)} aria-label="Search accounts"/>
          </div>
          <div className="rd-customer-list">
            {custList.filter(c => c.id === '__all__' || c.id === '__mine__').map(c => (
              <button key={c.id} type="button"
                className={'rd-list-item'+(selCustomer===c.id?' active':'')}
                onClick={()=>{setSelCustomer(c.id);setFilter('all')}}>
                <i className={'ti '+(c.id==='__all__'?'ti-list-details':'ti-package')} aria-hidden="true"/>
                <span className="rd-cust-label">{c.label}</span>
                <span className="rd-list-count">{c.count}</span>
              </button>
            ))}
            <div className="rd-cust-section">Customers · {subs.length}</div>
            {custList.filter(c => c.id !== '__all__' && c.id !== '__mine__')
              .filter(c => !custSearch || c.label.toLowerCase().includes(custSearch.toLowerCase()) || (c.code || '').toLowerCase().includes(custSearch.toLowerCase()))
              .map(c => {
                const tone = c.count === 0 ? 'none' : c.pending > 0 ? 'warn' : 'ok'
                const sub = c.count === 0 ? 'no plans yet'
                  : c.pending > 0 ? `${c.pending} in setup${c.oldestDays > 0 ? ` · oldest ${c.oldestDays}d` : ''}`
                  : 'all automated'
                return (
                  <button key={c.id} type="button"
                    className={'rd-cust-item'+(selCustomer===c.id?' active':'')}
                    onClick={()=>{setSelCustomer(c.id);setFilter('all')}}>
                    <span className={'rd-cust-avatar '+tone}>{c.initials}</span>
                    <span className="rd-cust-text">
                      <span className="rd-cust-label">{c.label}</span>
                      <span className={'rd-cust-sub '+tone}>{sub}</span>
                    </span>
                    {selCustomer===c.id && <i className="ti ti-chevron-right rd-cust-chev" aria-hidden="true"/>}
                  </button>
                )
              })}
          </div>
        </div>

        {/* Right: orders panel */}
        <div className="rd-main">
          <div className="rd-main-head">
            <div>
              <div className="rd-main-title">{selInfo?.label || 'Subscriptions'}{selInfo?.code && <span className="cust-code">{selInfo.code}</span>}</div>
              <div className="rd-main-sub">{selInfo?.count ?? 0} subscription{selInfo?.count!==1?'s':''}{selInfo?.pending>0 ? ` · ${selInfo.pending} need action` : ''}</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              {selCustomer !== '__all__' && selCustomer !== '__mine__' && (
                <div className="rd-main-actions">
                  <span className="rd-main-stat ok">{allOrders?.filter(o=>o.user_id===selCustomer&&deliverables(o).activated).length||0} automated</span>
                  <span className="rd-main-stat warn">{allOrders?.filter(o=>o.user_id===selCustomer&&!deliverables(o).activated).length||0} pending</span>
                  <Link to={`/order-for/${selCustomer}`} className="btn primary rd-main-buy">
                    <i className="ti ti-shopping-cart" style={{fontSize:13,verticalAlign:-2,marginRight:5}} aria-hidden="true"/>
                    Buy for this customer
                  </Link>
                </div>
              )}
              {visibleRows.length > 0 && (() => {
                const custLabel = selCustomer === '__all__' ? 'all' : selCustomer === '__mine__' ? 'inventory' : (subs.find(c=>c.id===selCustomer)?.full_name||'customer').replace(/\s+/g,'-').toLowerCase()
                const inclCust = selCustomer === '__all__'
                const custName = selCustomer !== '__all__' && selCustomer !== '__mine__' ? (subs.find(c=>c.id===selCustomer)?.full_name||null) : null
                return <ExportDropdown rows={visibleRows} custLabel={custLabel} inclCust={inclCust} custName={custName}/>
              })()}
            </div>
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

/* Reseller opens a customer's dashboard. The reseller stays signed in as
   themselves — every query still runs under their own auth. This renders the
   same CustomerDashboard the customer sees, scoped to their id. */
export function DashboardAsCustomer() {
  const { session, profile, loading } = useAuth()
  const { customerId } = useParams()
  const [target, setTarget] = useState(undefined)

  useEffect(() => {
    if (!session || !customerId) return
    let alive = true
    supabase.from('profiles')
      .select('id, full_name, customer_code, email, company_name, parent_reseller_id, account_type')
      .eq('id', customerId).maybeSingle()
      .then(({ data }) => { if (alive) setTarget(data || null) })
    return () => { alive = false }
  }, [session, customerId])

  if (loading || (session && !profile)) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard' }} />
  if (profile.account_type !== 'reseller') return <Navigate to="/dashboard" replace />
  if (target === undefined) return <div className="form-page"><p>Loading…</p></div>
  if (!target || target.parent_reseller_id !== session.user.id) {
    return (
      <div className="form-page">
        <p><strong>Not found.</strong> That customer is not on your account.</p>
        <Link to="/dashboard/customers" className="btn ghost">← Back to customers</Link>
      </div>
    )
  }

  const asSession = { ...session, user: { ...session.user, id: target.id } }
  const initial = (target.full_name || target.email || '?')[0].toUpperCase()

  return (
    <>
      <div className="as-bar">
        <span className="as-av">{initial}</span>
        <span className="as-txt">
          Viewing <b>{target.full_name || target.email}</b>
          {target.customer_code && <span className="as-code">{target.customer_code}</span>}
          <span className="as-note">— their dashboard, as they see it. Anything you do here applies to their account.</span>
        </span>
        <Link to="/dashboard/customers" className="as-exit">← Back to my account</Link>
      </div>
      {target.account_type === 'reseller'
        ? <ResellerDashboard session={asSession} profile={target} />
        : <CustomerDashboard session={asSession} profile={target} />}
    </>
  )
}

/* Customer list for a sub-reseller, viewed by their parent. Same guards as
   DashboardAsCustomer; passes the target down so every scope on the page is
   the sub-reseller rather than the signed-in viewer. */
export function CustomersAsReseller() {
  const { session, profile, loading } = useAuth()
  const { customerId } = useParams()
  const [target, setTarget] = useState(undefined)

  useEffect(() => {
    if (!session || !customerId) return
    let alive = true
    supabase.from('profiles')
      .select('id, full_name, customer_code, email, company_name, parent_reseller_id, account_type, can_create_resellers')
      .eq('id', customerId).maybeSingle()
      .then(({ data }) => { if (alive) setTarget(data || null) })
    return () => { alive = false }
  }, [session, customerId])

  if (loading || (session && !profile)) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard' }} />
  if (profile.account_type !== 'reseller') return <Navigate to="/dashboard" replace />
  if (target === undefined) return <div className="form-page"><p>Loading…</p></div>
  if (!target || target.parent_reseller_id !== session.user.id || target.account_type !== 'reseller') {
    return (
      <div className="form-page">
        <p><strong>Not found.</strong> That reseller is not on your account.</p>
        <Link to="/dashboard/customers" className="btn ghost">← Back to customers</Link>
      </div>
    )
  }

  const initial = (target.full_name || target.email || '?')[0].toUpperCase()
  return (
    <>
      <div className="as-bar">
        <span className="as-av">{initial}</span>
        <span className="as-txt">
          Viewing <b>{target.full_name || target.email}</b>
          {target.customer_code && <span className="as-code">{target.customer_code}</span>}
          <span className="as-note">— their customers, as they see them.</span>
        </span>
        <Link to="/dashboard/customers" className="as-exit">← Back to my account</Link>
      </div>
      <Customers viewAs={target} />
    </>
  )
}

export default function Dashboard() {
  const { session, profile, loading } = useAuth()
  if (loading || (session && !profile)) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard' }} />
  return profile.account_type === 'reseller'
    ? <ResellerDashboard session={session} profile={profile} />
    : <CustomerDashboard session={session} profile={profile} />
}
