import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { deliverables } from './Dashboard.jsx'

const ENVS = ['production', 'staging', 'development', 'other']
const ENV_COLOR = { production: '#1a7a4c', staging: '#b8862b', development: '#2e6ba2', other: '#7a8fa0' }
const ENV_BG    = { production: '#e0f4ea', staging: '#fff3d4', development: '#e8f2ff', other: '#f4f6f8' }

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return s }
}

/* ─── CUSTOMER servers view ─── */
function CustomerServers({ session }) {
  const [servers, setServers] = useState(null)
  const [orders, setOrders] = useState([])
  const [domains, setDomains] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', hostname: '', environment: 'production', webserver: '' })
  const [newDomain, setNewDomain] = useState({})
  const [expanded, setExpanded] = useState({})
  const [err, setErr] = useState(null)

  async function reload() {
    const uid = session.user.id
    const [s, o, d] = await Promise.all([
      supabase.from('servers').select('*').eq('owner_id', uid).order('created_at'),
      supabase.from('orders').select('*').eq('user_id', uid),
      supabase.from('tracked_domains').select('*').eq('owner_id', uid).order('domain'),
    ])
    setServers(s.data || [])
    setOrders(o.data || [])
    setDomains(d.data || [])
    setErr(s.error?.message || null)
  }

  useEffect(() => { reload() }, [session.user.id])

  async function addServer(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    await supabase.from('servers').insert({ owner_id: session.user.id, name: form.name.trim(), hostname: form.hostname.trim() || null, environment: form.environment, webserver: form.webserver || null })
    setForm({ name: '', hostname: '', environment: 'production', webserver: '' })
    setShowForm(false)
    reload()
  }

  async function removeServer(id) {
    if (!confirm('Remove this server? Your plans stay — they just lose this tag.')) return
    await supabase.from('servers').delete().eq('id', id)
    reload()
  }

  async function addDomain(serverId) {
    const v = (newDomain[serverId] || '').trim().toLowerCase()
    if (!v) return
    await supabase.from('tracked_domains').insert({ owner_id: session.user.id, server_id: serverId, domain: v })
    setNewDomain({ ...newDomain, [serverId]: '' })
    reload()
  }

  async function removeDomain(id) {
    await supabase.from('tracked_domains').delete().eq('id', id)
    reload()
  }

  const totalCerts = orders.filter(o => o.server_id).length
  const totalDomains = orders.reduce((n, o) => n + deliverables(o).vendorDomains.length, 0)
  const automated = orders.filter(o => deliverables(o).activated).length

  return (
    <div className="dash-page">
      <div className="srv-header">
        <div>
          <span className="eyebrow">Infrastructure</span>
          <h1>Your servers</h1>
          <p className="sub">Tag each certificate to the server it runs on — so you always know what is secured where.</p>
        </div>
        {servers && servers.length > 0 && (
          <button className="btn primary" type="button" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : '+ Add server'}
          </button>
        )}
      </div>

      <div className="srv-kpis">
        <div className="srv-kpi"><div className="srv-kpi-num">{servers?.length ?? '…'}</div><div className="srv-kpi-label">Servers</div></div>
        <div className="srv-kpi"><div className="srv-kpi-num">{totalCerts}</div><div className="srv-kpi-label">Certs tagged</div></div>
        <div className="srv-kpi srv-kpi-ok"><div className="srv-kpi-num">{automated}</div><div className="srv-kpi-label">Automated</div></div>
        <div className="srv-kpi"><div className="srv-kpi-num">{totalDomains}</div><div className="srv-kpi-label">Domains secured</div></div>
      </div>

      {err && <div className="alert error">{err}</div>}

      {showForm && (
        <form onSubmit={addServer} className="srv-add-form">
          <div className="srv-form-header">
            <i className="ti ti-server-2" style={{ fontSize: 22, color: '#3375b1' }} aria-hidden="true" />
            <div>
              <h3 className="srv-form-title">Add a server</h3>
              <p className="srv-form-sub">Once added, attach SSL plans to it from your certificate dashboard.</p>
            </div>
          </div>

          <div className="srv-form-grid">
            <div className="srv-form-section">
              <div className="srv-form-section-label">Server identity</div>
              <div className="field">
                <label htmlFor="sname">Server name <span className="req">*</span></label>
                <input id="sname" required autoFocus placeholder='e.g. web-01, api-server, client-vps'
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                <p className="hint">A short label you will recognise in the dashboard.</p>
              </div>
              <div className="field">
                <label htmlFor="shost">Hostname or IP address <span className="opt">optional</span></label>
                <input id="shost" placeholder='e.g. 203.0.113.10 or server.example.com'
                  value={form.hostname} onChange={e => setForm({ ...form, hostname: e.target.value })} />
                <p className="hint">Shown alongside the server name for reference — not used technically.</p>
              </div>
            </div>

            <div className="srv-form-section">
              <div className="srv-form-section-label">Environment &amp; stack</div>
              <div className="field">
                <label htmlFor="senv">Environment</label>
                <div className="srv-env-selector">
                  {ENVS.map(v => (
                    <button key={v} type="button"
                      className={'srv-env-opt' + (form.environment === v ? ' on' : '')}
                      onClick={() => setForm({ ...form, environment: v })}>
                      <span className="srv-env-opt-dot" style={{ background: ENV_COLOR[v] }} />
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="swebserver">Web server <span className="opt">optional</span></label>
                <select id="swebserver" value={form.webserver || ''} onChange={e => setForm({ ...form, webserver: e.target.value })}>
                  <option value="">— select if known —</option>
                  {['Apache', 'Nginx', 'Caddy', 'Traefik', 'IIS', 'LiteSpeed', 'Other'].map(w => <option key={w} value={w}>{w}</option>)}
                </select>
                <p className="hint">Helps identify the right AutoInstall agent configuration.</p>
              </div>
            </div>
          </div>

          <div className="srv-form-footer">
            <button className="btn primary" type="submit">
              <i className="ti ti-device-floppy" aria-hidden="true" /> Save server
            </button>
            <button className="btn ghost" type="button" onClick={() => setShowForm(false)}>Cancel</button>
            <p className="srv-form-note">After saving, go to your <strong>certificate dashboard</strong> to attach SSL plans to this server.</p>
          </div>
        </form>
      )}

      {servers && servers.length === 0 && !showForm && (
        <div className="srv-empty">
          <i className="ti ti-server-2" style={{ fontSize: 36, color: '#b4dffc' }} aria-hidden="true" />
          <h3>No servers yet</h3>
          <p>Add a server, then attach SSL plans to it from your <Link to="/dashboard">certificate dashboard</Link>.</p>
          <button className="btn primary" type="button" onClick={() => setShowForm(true)}>+ Add your first server</button>
        </div>
      )}

      <div className="srv-grid">
        {(servers || []).map(s => {
          const attached = orders.filter(o => o.server_id === s.id)
          const doms = domains.filter(d => d.server_id === s.id)
          const secured = [...new Set(attached.flatMap(o => deliverables(o).vendorDomains.map(v => typeof v === 'string' ? v : v?.name || '')).filter(Boolean))]
          const allOk = attached.length > 0 && attached.every(o => deliverables(o).activated)
          const anyPending = attached.some(o => !deliverables(o).activated)
          const isOpen = expanded[s.id]

          return (
            <div className="srv-card" key={s.id}>
              <div className="srv-card-head" onClick={() => setExpanded(x => ({ ...x, [s.id]: !x[s.id] }))}>
                <div className="srv-card-left">
                  <div className="srv-card-icon"><i className="ti ti-server-2" aria-hidden="true" /></div>
                  <div>
                    <div className="srv-card-name">{s.name}</div>
                    {s.hostname && <div className="srv-card-host">{s.hostname}</div>}
                  </div>
                </div>
                <div className="srv-card-right">
                  <span className="srv-env-pill" style={{ background: ENV_BG[s.environment], color: ENV_COLOR[s.environment] }}>{s.environment}</span>
                  <span className="srv-cert-count">{attached.length} cert{attached.length !== 1 ? 's' : ''}</span>
                  <span className={'srv-health-dot ' + (allOk ? 'ok' : anyPending ? 'warn' : 'idle')} />
                  <span className="srv-chev">{isOpen ? '▾' : '▸'}</span>
                </div>
              </div>

              {isOpen && (
                <div className="srv-card-body">
                  {/* Certs section */}
                  <div className="srv-section-label">SSL certificates</div>
                  {attached.length === 0
                    ? <p className="srv-muted">No plans attached. <Link to="/dashboard">Open your dashboard</Link> to tag a plan to this server.</p>
                    : attached.map(o => {
                        const d = deliverables(o)
                        return (
                          <div className="srv-plan-row" key={o.id}>
                            <span className={'srv-plan-dot ' + (d.activated ? 'ok' : 'warn')} />
                            <span className="srv-plan-name">{o.product_name}</span>
                            <span className="srv-plan-id">#{o.gogetssl_order_id}</span>
                            <span className={'srv-plan-status ' + (d.activated ? 'ok' : 'warn')}>{d.activated ? 'Automated ✓' : 'Pending setup'}</span>
                            {d.renewal && <span className="srv-plan-renew">renews {fmtDate(d.renewal)}</span>}
                          </div>
                        )
                      })
                  }

                  {/* Domains section */}
                  <div className="srv-section-label" style={{ marginTop: 12 }}>Secured domains</div>
                  <div className="srv-chips">
                    {secured.map(dom => <span key={'v-'+dom} className="srv-chip srv-chip-lock"><i className="ti ti-lock" style={{ fontSize: 10 }} aria-hidden="true" /> {dom}</span>)}
                    {doms.map(d => (
                      <span key={d.id} className="srv-chip">
                        {d.domain}
                        <button type="button" className="srv-chip-remove" onClick={() => removeDomain(d.id)} aria-label={`Remove ${d.domain}`}>✕</button>
                      </span>
                    ))}
                    {secured.length === 0 && doms.length === 0 && <span className="srv-muted">No domains yet.</span>}
                  </div>
                  <div className="srv-domain-add">
                    <input placeholder="add domain e.g. shop.example.com" value={newDomain[s.id] || ''}
                      onChange={e => setNewDomain({ ...newDomain, [s.id]: e.target.value })}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addDomain(s.id))} />
                    <button className="btn ghost" type="button" onClick={() => addDomain(s.id)}>Track</button>
                  </div>

                  <button className="srv-remove-btn" type="button" onClick={() => removeServer(s.id)}>Remove server</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── RESELLER server rollup view ─── */
function ResellerServers({ session }) {
  const [ownServers, setOwnServers]     = useState(null)
  const [subServers, setSubServers]     = useState([])
  const [ownOrders, setOwnOrders]       = useState([])
  const [subOrders, setSubOrders]       = useState([])
  const [profiles, setProfiles]         = useState([])
  const [subDomains, setSubDomains]     = useState([])
  const [expanded, setExpanded]         = useState({})
  const [err, setErr]                   = useState(null)

  useEffect(() => {
    const uid = session.user.id
    Promise.all([
      supabase.from('servers').select('*').eq('owner_id', uid).order('name'),
      supabase.from('servers').select('*').neq('owner_id', uid).order('name'),
      supabase.from('orders').select('*').eq('user_id', uid),
      supabase.from('orders').select('*').neq('user_id', uid),
      supabase.from('profiles').select('id, full_name').eq('parent_reseller_id', uid),
      supabase.from('tracked_domains').select('*').neq('owner_id', uid),
    ]).then(([os, ss, oo, so, p, sd]) => {
      setOwnServers(os.data || [])
      setSubServers(ss.data || [])
      setOwnOrders(oo.data || [])
      setSubOrders(so.data || [])
      setProfiles(p.data || [])
      setSubDomains(sd.data || [])
      setErr(os.error?.message || null)
    })
  }, [session.user.id])

  const allServers = [...(ownServers || []), ...subServers]
  const allOrders  = [...ownOrders, ...subOrders]
  const totalCerts = allOrders.filter(o => o.server_id).length
  const automated  = allOrders.filter(o => deliverables(o).activated).length
  const needsAction = allOrders.filter(o => !deliverables(o).activated).length

  const customerName = id => id === session.user.id ? 'Your servers' : (profiles.find(p => p.id === id)?.full_name || 'Customer')

  // Group servers by owner
  const owners = [...new Set(allServers.map(s => s.owner_id))]

  return (
    <div className="dash-page">
      <span className="eyebrow">Infrastructure rollup</span>
      <h1>All servers</h1>
      <p className="sub">A live map of every server across your account and customer sub-accounts.</p>

      <div className="srv-kpis">
        <div className="srv-kpi"><div className="srv-kpi-num">{allServers.length}</div><div className="srv-kpi-label">Total servers</div></div>
        <div className="srv-kpi"><div className="srv-kpi-num">{profiles.length}</div><div className="srv-kpi-label">Customers</div></div>
        <div className="srv-kpi srv-kpi-ok"><div className="srv-kpi-num">{automated}</div><div className="srv-kpi-label">Certs automated</div></div>
        <div className="srv-kpi srv-kpi-warn"><div className="srv-kpi-num">{needsAction}</div><div className="srv-kpi-label">Needs action</div></div>
      </div>

      {err && <div className="alert error">{err}</div>}

      {allServers.length === 0 && (
        <div className="srv-empty">
          <i className="ti ti-server-2" style={{ fontSize: 36, color: '#b4dffc' }} aria-hidden="true" />
          <h3>No servers registered</h3>
          <p>Your customers can add servers from their dashboard. Once added, they appear here in your rollup.</p>
        </div>
      )}

      <div className="rsrv-tree">
        {owners.map(ownerId => {
          const ownerServers = allServers.filter(s => s.owner_id === ownerId)
          const label = customerName(ownerId)
          const ownerOrders = allOrders.filter(o => o.user_id === ownerId)
          const ownerDomains = ownerId === session.user.id ? [] : subDomains.filter(d => d.owner_id === ownerId)
          const ownerAuto = ownerOrders.filter(o => deliverables(o).activated).length
          const ownerPending = ownerOrders.filter(o => !deliverables(o).activated).length

          return (
            <div className="rsrv-customer-group" key={ownerId}>
              <div className="rsrv-customer-head">
                <i className="ti ti-user" style={{ fontSize: 14, color: '#7a8fa0' }} aria-hidden="true" />
                <span className="rsrv-customer-name">{label}</span>
                <span className="rsrv-customer-stats">
                  {ownerServers.length} server{ownerServers.length !== 1 ? 's' : ''}
                  {ownerAuto > 0 && <span className="rsrv-tag ok">{ownerAuto} automated</span>}
                  {ownerPending > 0 && <span className="rsrv-tag warn">{ownerPending} pending</span>}
                </span>
              </div>

              {ownerServers.map(s => {
                const attached = allOrders.filter(o => o.server_id === s.id)
                const doms = ownerDomains.filter(d => d.server_id === s.id)
                const secured = [...new Set(attached.flatMap(o => deliverables(o).vendorDomains.map(v => typeof v === 'string' ? v : v?.name || '')).filter(Boolean))]
                const allOk = attached.length > 0 && attached.every(o => deliverables(o).activated)
                const anyPend = attached.some(o => !deliverables(o).activated)
                const isOpen = expanded[s.id]

                return (
                  <div className="rsrv-server-row" key={s.id}>
                    <div className="rsrv-server-head" onClick={() => setExpanded(x => ({ ...x, [s.id]: !x[s.id] }))}>
                      <span className={'rsrv-health ' + (allOk ? 'ok' : anyPend ? 'warn' : 'idle')} />
                      <i className="ti ti-server-2" style={{ fontSize: 13, color: '#7a8fa0' }} aria-hidden="true" />
                      <span className="rsrv-server-name">{s.name}</span>
                      {s.hostname && <span className="rsrv-server-host">{s.hostname}</span>}
                      <span className="rsrv-env-pill" style={{ background: ENV_BG[s.environment], color: ENV_COLOR[s.environment] }}>{s.environment}</span>
                      <span className="rsrv-counts">
                        <span>{attached.length} cert{attached.length !== 1 ? 's' : ''}</span>
                        <span>{(secured.length + doms.length)} domain{secured.length + doms.length !== 1 ? 's' : ''}</span>
                      </span>
                      <span className="rsrv-chev">{isOpen ? '▾' : '▸'}</span>
                    </div>

                    {isOpen && (
                      <div className="rsrv-server-detail">
                        {attached.length === 0
                          ? <p className="srv-muted">No plans attached to this server.</p>
                          : attached.map(o => {
                              const d = deliverables(o)
                              return (
                                <div className="rsrv-plan-row" key={o.id}>
                                  <span className={'srv-plan-dot ' + (d.activated ? 'ok' : 'warn')} />
                                  <span className="rsrv-plan-name">{o.product_name}</span>
                                  <span className="srv-plan-id">#{o.gogetssl_order_id}</span>
                                  <span className={'srv-plan-status ' + (d.activated ? 'ok' : 'warn')}>{d.activated ? 'Automated ✓' : 'Pending'}</span>
                                  {d.renewal && <span className="srv-plan-renew">renews {fmtDate(d.renewal)}</span>}
                                </div>
                              )
                            })
                        }
                        {(secured.length > 0 || doms.length > 0) && (
                          <div className="rsrv-domains">
                            {secured.map(dom => <span key={'v-'+dom} className="srv-chip srv-chip-lock"><i className="ti ti-lock" style={{ fontSize: 9 }} aria-hidden="true" /> {dom}</span>)}
                            {doms.map(d => <span key={d.id} className="srv-chip">{d.domain}</span>)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Entry ─── */
export default function Servers() {
  const { session, profile, loading } = useAuth()
  if (loading || (session && !profile)) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard/servers' }} />
  return profile?.account_type === 'reseller'
    ? <ResellerServers session={session} />
    : <CustomerServers session={session} />
}
