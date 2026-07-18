import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { deliverables } from './Dashboard.jsx'

export default function Customers() {
  const { session, profile, loading } = useAuth()
  const [subs, setSubs] = useState(null)
  const [servers, setServers] = useState([])
  const [orders, setOrders] = useState([])
  const [domains, setDomains] = useState([])
  const [form, setForm] = useState({ email: '', password: '', full_name: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  async function reload() {
    const [p, s, o, d] = await Promise.all([
      supabase.from('profiles').select('id, full_name, created_at').eq('parent_reseller_id', session.user.id).order('created_at'),
      supabase.from('servers').select('id, owner_id, name, environment').neq('owner_id', session.user.id),
      supabase.from('orders').select('id, user_id, server_id, product_name, status, product_id, api_response, assigned_at').neq('user_id', session.user.id),
      supabase.from('tracked_domains').select('id, owner_id, server_id, domain').neq('owner_id', session.user.id),
    ])
    setSubs(p.data || [])
    setServers(s.data || [])
    setOrders(o.data || [])
    setDomains(d.data || [])
    setErr(p.error?.message || null)
  }

  useEffect(() => {
    if (session?.user && supabase && profile?.account_type === 'reseller') reload()
  }, [session?.user?.id, profile?.account_type])

  if (loading || (session && !profile)) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard/customers' }} />
  if (profile.account_type !== 'reseller') return <Navigate to="/dashboard" replace />

  async function createSub(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/subaccount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
        body: JSON.stringify(form),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.message || 'Could not create the account.')
      setMsg(`Account created for ${form.email}. Share the credentials with your customer — they can sign in right away.`)
      setForm({ email: '', password: '', full_name: '' })
      reload()
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="form-page wide">
      <span className="eyebrow">Reseller console</span>
      <h1>Your customers</h1>
      <p className="sub">Create customer accounts under your umbrella and see everything they run, rolled up per customer.</p>

      <form onSubmit={createSub} className="order-summary" style={{ marginBottom: 20 }}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="cname">Customer name</label>
            <input id="cname" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="cemail">Email</label>
            <input id="cemail" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="cpass">Temporary password</label>
            <input id="cpass" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
        </div>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create customer account'}</button>
      </form>

      {msg && <div className="alert ok">{msg}</div>}
      {err && <div className="alert error">{err}</div>}
      {subs && subs.length === 0 && <div className="alert ok">No customer accounts yet — create the first one above.</div>}

      {(subs || []).map((c) => {
        const cs = servers.filter((s) => s.owner_id === c.id)
        const co = orders.filter((o) => o.user_id === c.id)
        const cd = domains.filter((d) => d.owner_id === c.id)
        const activated = co.filter((o) => deliverables(o).activated).length
        return (
          <div className="alert ok" key={c.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <strong>{c.full_name || 'Unnamed customer'}</strong>
              <span className="mono" style={{ fontSize: '0.78rem' }}>
                {cs.length} server{cs.length === 1 ? '' : 's'} · {co.length} plan{co.length === 1 ? '' : 's'} ({activated} activated, {co.length - activated} pending) · {cd.length} domain{cd.length === 1 ? '' : 's'}
              </span>
            </div>
            {cs.map((s) => {
              const so = co.filter((o) => o.server_id === s.id)
              const sd = cd.filter((d) => d.server_id === s.id)
              return (
                <div key={s.id} className="kv" style={{ marginTop: 8, paddingLeft: 10, borderLeft: '3px solid var(--line)' }}>
                  <div><b>{s.name}</b> ({s.environment}) — {so.map((o) => o.product_name).join(', ') || 'no plans attached'}</div>
                  {sd.length > 0 && <div className="mono" style={{ fontSize: '0.78rem' }}>{sd.map((d) => d.domain).join(' · ')}</div>}
                </div>
              )
            })}
            {co.filter((o) => !o.server_id).length > 0 && (
              <div className="kv" style={{ marginTop: 8 }}>
                <div><b>Unassigned plans</b> {co.filter((o) => !o.server_id).map((o) => `${o.product_name} (${o.status})`).join(', ')}</div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
