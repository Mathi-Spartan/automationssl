import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { deliverables } from './Dashboard.jsx'

const ENVS = ['production', 'staging', 'development', 'other']
const ENV_ICON = { production: '🟢', staging: '🟡', development: '🔵', other: '⚪️' }

export default function Servers() {
  const { session, loading } = useAuth()
  const [servers, setServers] = useState(null)
  const [orders, setOrders] = useState([])
  const [domains, setDomains] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', hostname: '', environment: 'production' })
  const [newDomain, setNewDomain] = useState({})
  const [err, setErr] = useState(null)

  async function reload(uid) {
    const [s, o, d] = await Promise.all([
      supabase.from('servers').select('*').eq('owner_id', uid).order('created_at'),
      supabase.from('orders').select('*').eq('user_id', uid),
      supabase.from('tracked_domains').select('*').eq('owner_id', uid).order('domain'),
    ])
    setServers(s.data || [])
    setOrders(o.data || [])
    setDomains(d.data || [])
    setErr(s.error?.message || o.error?.message || d.error?.message || null)
  }

  useEffect(() => {
    if (session?.user && supabase) reload(session.user.id)
  }, [session?.user?.id])

  if (loading) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard/servers' }} />

  async function addServer(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    const { error } = await supabase.from('servers').insert({
      owner_id: session.user.id,
      name: form.name.trim(),
      hostname: form.hostname.trim() || null,
      environment: form.environment,
    })
    if (error) setErr(error.message)
    else {
      setForm({ name: '', hostname: '', environment: 'production' })
      setShowForm(false)
      reload(session.user.id)
    }
  }

  async function removeServer(id) {
    if (!confirm('Remove this server? Your plans and domains stay — they just lose this tag.')) return
    await supabase.from('servers').delete().eq('id', id)
    reload(session.user.id)
  }

  async function addDomain(serverId) {
    const value = (newDomain[serverId] || '').trim().toLowerCase()
    if (!value) return
    const { error } = await supabase.from('tracked_domains').insert({
      owner_id: session.user.id,
      server_id: serverId,
      domain: value,
    })
    if (error) setErr(error.message)
    else {
      setNewDomain({ ...newDomain, [serverId]: '' })
      reload(session.user.id)
    }
  }

  async function removeDomain(id) {
    await supabase.from('tracked_domains').delete().eq('id', id)
    reload(session.user.id)
  }

  return (
    <div className="form-page wide">
      <div className="page-head">
        <div>
          <span className="eyebrow">Servers</span>
          <h1>Where your certificates live</h1>
          <p className="sub">
            A read-only map of your infrastructure — one card per machine, showing the plans
            and domains on each. To connect a plan to a server, open it on the{' '}
            <Link to="/dashboard" style={{ textDecoration: 'underline' }}>dashboard</Link> and pick the server there.
          </p>
        </div>
        <button className="btn primary" type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Close' : '+ Add server'}
        </button>
      </div>

      {err && <div className="alert error">{err}</div>}

      {showForm && (
        <form onSubmit={addServer} className="add-server-card">
          <div className="field-row">
            <div className="field">
              <label htmlFor="sname">Server name</label>
              <input id="sname" required placeholder="web-01" autoFocus value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <p className="hint">Any name you'll recognise — "web-01", "Client VPS", "Apache box".</p>
            </div>
            <div className="field">
              <label htmlFor="shost">Hostname or IP <span className="opt">optional</span></label>
              <input id="shost" placeholder="203.0.113.10" value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="senv">Environment</label>
              <select id="senv" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
                {ENVS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
          <button className="btn primary" type="submit">Save server</button>
        </form>
      )}

      {servers && servers.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-icon">🖥️</div>
          <h3>No servers yet</h3>
          <p>Add the machines your sites run on, then attach each SSL plan to its server —
          so you always know what's secured where.</p>
          <button className="btn primary" type="button" onClick={() => setShowForm(true)}>+ Add your first server</button>
        </div>
      )}

      <div className="server-grid">
        {(servers || []).map((s) => {
          const attached = orders.filter((o) => o.server_id === s.id)
          const doms = domains.filter((d) => d.server_id === s.id)
          const secured = [...new Set(attached.flatMap((o) =>
            deliverables(o).vendorDomains.map((v) => (typeof v === 'string' ? v : v?.name || v?.domain || ''))
          ).filter(Boolean))]
          return (
            <div className="server-card" key={s.id}>
              <div className="server-head">
                <div>
                  <span className="server-name">🖥️ {s.name}</span>
                  {s.hostname && <span className="server-host">{s.hostname}</span>}
                </div>
                <span className={'pill env-' + s.environment}>{ENV_ICON[s.environment]} {s.environment}</span>
              </div>

              <div className="server-section">
                <div className="server-section-title">SSL plans <span className="count">{attached.length}</span></div>
                {attached.length === 0 && <p className="muted-line">Nothing attached yet.</p>}
                {attached.map((o) => {
                  const d = deliverables(o)
                  return (
                    <div className="server-plan" key={o.id}>
                      <span className={'dot ' + (d.activated ? 'ok' : 'warn')} aria-hidden="true" />
                      <span className="server-plan-name">{o.product_name} <span className="mono">#{o.gogetssl_order_id}</span></span>
                      <span className="server-plan-state">{d.activated ? 'automated' : 'pending setup'}</span>
                    </div>
                  )
                })}
              </div>

              <div className="server-section">
                <div className="server-section-title">Domains <span className="count">{secured.length + doms.length}</span></div>
                <div className="chips">
                  {secured.map((dom) => (
                    <span key={'v-' + dom} className="chip lock" title="Secured by an attached plan">🔒 {dom}</span>
                  ))}
                  {doms.map((d) => (
                    <span key={d.id} className="chip">
                      {d.domain}
                      <button type="button" onClick={() => removeDomain(d.id)} aria-label={`Remove ${d.domain}`}>✕</button>
                    </span>
                  ))}
                </div>
                <div className="chip-add">
                  <input placeholder="shop.example.com" value={newDomain[s.id] || ''}
                    onChange={(e) => setNewDomain({ ...newDomain, [s.id]: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDomain(s.id))} />
                  <button className="btn ghost" type="button" onClick={() => addDomain(s.id)}>Add</button>
                </div>
              </div>

              <button className="linklike danger" type="button" onClick={() => removeServer(s.id)}>Remove server</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
