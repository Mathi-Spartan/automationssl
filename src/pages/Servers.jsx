import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'

const ENVS = ['production', 'staging', 'development', 'other']

export default function Servers() {
  const { session, loading } = useAuth()
  const [servers, setServers] = useState(null)
  const [orders, setOrders] = useState([])
  const [domains, setDomains] = useState([])
  const [form, setForm] = useState({ name: '', hostname: '', environment: 'production' })
  const [newDomain, setNewDomain] = useState({})
  const [err, setErr] = useState(null)

  async function reload(uid) {
    const [s, o, d] = await Promise.all([
      supabase.from('servers').select('*').eq('owner_id', uid).order('created_at'),
      supabase.from('orders').select('id, product_name, status, server_id, gogetssl_order_id').eq('user_id', uid),
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
      reload(session.user.id)
    }
  }

  async function removeServer(id) {
    if (!confirm('Remove this server? Plans stay, they just lose the tag.')) return
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
      <span className="eyebrow">Servers</span>
      <h1>Where your certificates live</h1>
      <p className="sub">
        Add your servers, attach plans to them from the{' '}
        <Link to="/dashboard" style={{ textDecoration: 'underline' }}>dashboard</Link>, and track which
        domains run where.
      </p>

      {err && <div className="alert error">{err}</div>}

      <form onSubmit={addServer} className="order-summary" style={{ marginBottom: 20 }}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="sname">Server name</label>
            <input id="sname" required placeholder="web-01" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="shost">Hostname / IP (optional)</label>
            <input id="shost" placeholder="203.0.113.10" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="senv">Environment</label>
            <select id="senv" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
              {ENVS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <button className="btn primary" type="submit">Add server</button>
      </form>

      {servers && servers.length === 0 && <div className="alert ok">No servers yet — add your first one above.</div>}

      {(servers || []).map((s) => {
        const attached = orders.filter((o) => o.server_id === s.id)
        const doms = domains.filter((d) => d.server_id === s.id)
        return (
          <div className="alert ok" key={s.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <strong>{s.name}</strong>
              <span className="mono" style={{ fontSize: '0.78rem' }}>
                {s.environment}{s.hostname ? ` · ${s.hostname}` : ''} · {attached.length} plan{attached.length === 1 ? '' : 's'} · {doms.length} domain{doms.length === 1 ? '' : 's'}
              </span>
            </div>

            {attached.length > 0 && (
              <div className="kv" style={{ marginTop: 8 }}>
                {attached.map((o) => (
                  <div key={o.id}><b>{o.product_name}</b> #{o.gogetssl_order_id} — {o.status}</div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              {doms.map((d) => (
                <span key={d.id} className="mono" style={{ display: 'inline-block', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', marginRight: 6, marginBottom: 6, fontSize: '0.8rem' }}>
                  {d.domain}{' '}
                  <button type="button" onClick={() => removeDomain(d.id)} style={{ border: 'none', background: 'none', cursor: 'pointer' }} aria-label={`Remove ${d.domain}`}>✕</button>
                </span>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input placeholder="add domain e.g. shop.example.com" value={newDomain[s.id] || ''}
                  onChange={(e) => setNewDomain({ ...newDomain, [s.id]: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDomain(s.id))} />
                <button className="btn ghost" type="button" onClick={() => addDomain(s.id)}>Add domain</button>
              </div>
            </div>

            <button className="btn ghost" type="button" style={{ marginTop: 10, fontSize: '0.8rem' }} onClick={() => removeServer(s.id)}>
              Remove server
            </button>
          </div>
        )
      })}
    </div>
  )
}
