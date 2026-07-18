import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { deliverables } from './Dashboard.jsx'
import { Stagger } from '../components/Motion.jsx'

export default function Customers() {
  const { session, profile, loading } = useAuth()
  const [subs, setSubs] = useState(null)
  const [orders, setOrders] = useState([])
  const [form, setForm] = useState({ email: '', password: '', full_name: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')

  async function reload() {
    const [p, o] = await Promise.all([
      supabase.from('profiles').select('id, full_name, created_at, customer_code').eq('parent_reseller_id', session.user.id).order('created_at'),
      supabase.from('orders').select('id, user_id, product_name, product_id, api_response, assigned_at, status').neq('user_id', session.user.id),
    ])
    setSubs(p.data || [])
    setOrders(o.data || [])
    setErr(p.error?.message || null)
  }

  useEffect(() => {
    if (session?.user && profile?.account_type === 'reseller') reload()
  }, [session?.user?.id, profile?.account_type])

  if (loading || (session && !profile)) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard/customers' }} />
  if (profile.account_type !== 'reseller') return <Navigate to="/dashboard" replace />

  async function createSub(e) {
    e.preventDefault()
    setBusy(true); setMsg(null); setErr(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/subaccount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
        body: JSON.stringify(form),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.message || 'Could not create the account.')
      setMsg(`Account created for ${form.email}. Share these credentials with your customer — they can sign in right away.`)
      setForm({ email: '', password: '', full_name: '' })
      setShowForm(false)
      reload()
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value })

  return (
    <div className="dash-page">
      <div className="cust-page-header">
        <div>
          <span className="eyebrow">Customers</span>
          <h1>Your customers</h1>
        </div>
        <button className="btn primary" type="button" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ New customer'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={createSub} className="cust-create-form">
          <h3 className="cust-form-title">Create customer account</h3>
          <div className="field-row">
            <div className="field">
              <label htmlFor="cname">Full name</label>
              <input id="cname" required placeholder="Acme Corp / John Smith" autoFocus
                value={form.full_name} onChange={set('full_name')} />
            </div>
            <div className="field">
              <label htmlFor="cemail">Email</label>
              <input id="cemail" type="email" required placeholder="customer@example.com"
                value={form.email} onChange={set('email')} />
            </div>
            <div className="field">
              <label htmlFor="cpass">Temporary password</label>
              <input id="cpass" type="password" required minLength={8}
                value={form.password} onChange={set('password')} />
              <p className="hint">Share this with your customer — they can change it after signing in.</p>
            </div>
          </div>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
      )}

      {msg && <div className="alert ok">{msg}</div>}
      {err && <div className="alert error">{err}</div>}

      {/* Customer list */}
      {subs && subs.length === 0 && !showForm && (
        <div className="cust-empty">
          <i className="ti ti-users" style={{ fontSize: 36, color: '#b4dffc' }} aria-hidden="true" />
          <h3>No customers yet</h3>
          <p>Create a customer account to get started. They can sign in, view their certificates, and set up automation themselves.</p>
          <button className="btn primary" type="button" onClick={() => setShowForm(true)}>+ New customer</button>
        </div>
      )}

      {subs && subs.length > 0 && (
        <div className="cust-search">
          <i className="ti ti-search" aria-hidden="true"/>
          <input type="text" placeholder="Search by name or ID (e.g. AS-1001)" value={search}
            onChange={e => setSearch(e.target.value)} aria-label="Search customers"/>
        </div>
      )}

      <Stagger className="cust-list" step={70}>
        {(subs || [])
          .filter(c => {
            if (!search.trim()) return true
            const q = search.trim().toLowerCase()
            return (c.full_name || '').toLowerCase().includes(q) || (c.customer_code || '').toLowerCase().includes(q)
          })
          .map(c => {
          const co = orders.filter(o => o.user_id === c.id)
          const activated = co.filter(o => deliverables(o).activated).length
          const pending = co.length - activated
          const joined = new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

          return (
            <div className="cust-row" key={c.id}>
              <div className="cust-row-left">
                <div className="cust-avatar">{(c.full_name || '?')[0].toUpperCase()}</div>
                <div>
                  <div className="cust-name">{c.full_name || 'Unnamed customer'}{c.customer_code && <span className="cust-code">{c.customer_code}</span>}</div>
                  <div className="cust-meta">Joined {joined}</div>
                </div>
              </div>
              <div className="cust-row-stats">
                <div className="cust-stat">
                  <span className="cust-stat-num">{co.length}</span>
                  <span className="cust-stat-label">Plans</span>
                </div>
                <div className={'cust-stat' + (activated > 0 ? ' ok' : '')}>
                  <span className="cust-stat-num">{activated}</span>
                  <span className="cust-stat-label">Automated</span>
                </div>
                <div className={'cust-stat' + (pending > 0 ? ' warn' : '')}>
                  <span className="cust-stat-num">{pending}</span>
                  <span className="cust-stat-label">Pending</span>
                </div>
              </div>
              <div className="cust-row-actions">
                <Link to={`/order-for/${c.id}`} className="btn primary" style={{ fontSize: '0.8rem', padding: '6px 14px' }}>
                  + Buy plan
                </Link>
                <Link to={`/dashboard?customer=${c.id}`} className="btn ghost" style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                  onClick={e => { e.preventDefault(); window.location.href = '/dashboard' }}>
                  View orders
                </Link>
              </div>
            </div>
          )
        })}
      </Stagger>
    </div>
  )
}
