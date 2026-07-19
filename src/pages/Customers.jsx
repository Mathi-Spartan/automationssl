import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { deliverables } from './Dashboard.jsx'
import { Stagger } from '../components/Motion.jsx'

export default function Customers({ viewAs = null }) {
  const { session, profile, loading } = useAuth()
  // When a reseller opens a sub-reseller's dashboard, every scope on this
  // page must be that sub-reseller — not the signed-in account. Without
  // this the page shows the viewer's own customers under someone else's
  // name.
  const scopeId = viewAs?.id || session?.user?.id
  const scopeProfile = viewAs || profile
  const [subs, setSubs] = useState(null)
  const [orders, setOrders] = useState([])
  const [form, setForm] = useState({ email: '', password: '', full_name: '', company_name: '', account_type: 'customer' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [edit, setEdit] = useState(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editMsg, setEditMsg] = useState(null)
  const [editErr, setEditErr] = useState(null)
  const [search, setSearch] = useState('')

  async function reload() {
    // Fetch children first, then their orders by explicit id. Using
    // .neq(scopeId) would return the VIEWER's other customers' orders while
    // impersonating, because the session is still the viewer's.
    const p = await supabase.from('profiles')
      .select('id, full_name, created_at, customer_code, email, company_name, account_type, can_create_resellers')
      .eq('parent_reseller_id', scopeId).order('created_at')
    const ids = (p.data || []).map((c) => c.id)
    const o = ids.length
      ? await supabase.from('orders')
          .select('id, user_id, product_name, product_id, api_response, assigned_at, status')
          .in('user_id', ids)
      : { data: [] }
    setSubs(p.data || [])
    setOrders(o.data || [])
    setErr(p.error?.message || null)
  }

  useEffect(() => {
    if (scopeId && scopeProfile?.account_type === 'reseller') reload()
  }, [scopeId, scopeProfile?.account_type])

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
      setForm({ email: '', password: '', full_name: '', company_name: '', account_type: 'customer' })
      setShowForm(false)
      reload()
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value })

  function openEdit(c) {
    setEditErr(null); setEditMsg(null)
    setEdit({
      id: c.id,
      full_name: c.full_name || '',
      company_name: c.company_name || '',
      email: c.email || '',
      password: '',
    })
  }

  async function saveEdit(e) {
    e.preventDefault()
    setEditBusy(true); setEditErr(null); setEditMsg(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const payload = {
        customer_id: edit.id,
        full_name: edit.full_name,
        company_name: edit.company_name,
        email: edit.email,
      }
      if (edit.password) payload.password = edit.password
      const res = await fetch('/api/subaccount', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.message || 'Could not save the changes.')
      const bits = []
      if (body.changed?.profile?.length) bits.push('profile')
      if (body.changed?.email) bits.push('email')
      if (body.changed?.password) bits.push('password')
      setEditMsg(bits.length ? `Saved — ${bits.join(', ')} updated.` : 'No changes to save.')
      setEdit(null)
      reload()
    } catch (e2) {
      setEditErr(e2.message)
    } finally {
      setEditBusy(false)
    }
  }

  const setE = k => e => setEdit({ ...edit, [k]: e.target.value })

  const [exporting, setExporting] = useState(false)

  /* Export every order beneath this account at any depth: direct customers,
     sub-resellers, and those sub-resellers' own customers. RLS already limits
     what is readable to the caller's subtree, so a broad select cannot leak. */
  async function exportAll() {
    setExporting(true)
    try {
      // Walk the tree level by level rather than assuming a fixed depth.
      const tree = []
      let frontier = [scopeId]
      for (let depth = 0; depth < 8 && frontier.length; depth += 1) {
        const { data } = await supabase.from('profiles')
          .select('id, full_name, email, customer_code, company_name, account_type, parent_reseller_id')
          .in('parent_reseller_id', frontier)
        const level = data || []
        level.forEach((r) => tree.push({ ...r, depth: depth + 1 }))
        frontier = level.map((r) => r.id)
      }

      const ids = tree.map((t) => t.id)
      const { data: ords } = ids.length
        ? await supabase.from('orders')
            .select('id, user_id, product_name, product_id, api_response, assigned_at, created_at, status')
            .in('user_id', ids)
        : { data: [] }

      const byId = Object.fromEntries(tree.map((t) => [t.id, t]))
      const parentName = (id) => byId[id]?.full_name || (id === scopeId ? 'You' : '—')

      const header = ['Account', 'Type', 'Account ID', 'Company', 'Email', 'Belongs to',
                      'Order #', 'Product', 'Domain(s)', 'Status', 'Renews', 'Ordered']
      const rows = [header]

      tree.forEach((acct) => {
        const theirs = (ords || []).filter((o) => o.user_id === acct.id)
        const base = [
          acct.full_name || 'Unnamed',
          acct.account_type === 'reseller' ? 'Reseller' : 'Customer',
          acct.customer_code || '',
          acct.company_name || '',
          acct.email || '',
          parentName(acct.parent_reseller_id),
        ]
        if (!theirs.length) {
          rows.push([...base, '', '', '', 'No orders', '', ''])
          return
        }
        theirs.forEach((o) => {
          const d = deliverables(o)
          const doms = (d.vendorDomains || [])
            .map((x) => (typeof x === 'string' ? x : x?.name || ''))
            .filter(Boolean).join(', ')
          rows.push([
            ...base,
            o.api_response?.order?.order_id || o.id?.slice(0, 8) || '',
            o.product_name || '',
            doms,
            d.activated ? 'Automated' : 'Needs setup',
            d.renewal ? new Date(d.renewal).toLocaleDateString('en-GB') : '',
            o.created_at ? new Date(o.created_at).toLocaleDateString('en-GB') : '',
          ])
        })
      })

      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 28 },
                     { wch: 20 }, { wch: 12 }, { wch: 34 }, { wch: 26 }, { wch: 14 },
                     { wch: 12 }, { wch: 12 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'All accounts')
      XLSX.writeFile(wb, `automationssl-accounts-${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) {
      setErr('Export failed: ' + (e.message || e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="dash-page">
      <div className="cust-page-header">
        <div>
          <span className="eyebrow">{scopeProfile?.can_create_resellers ? 'Accounts' : 'Customers'}</span>
          <h1>{scopeProfile?.can_create_resellers ? 'Your accounts' : 'Your customers'}</h1>
        </div>
        <div className="cust-head-actions">
          <button className="btn ghost" type="button" onClick={exportAll} disabled={exporting || !(subs || []).length}>
            <i className="ti ti-file-spreadsheet" style={{ fontSize: 14, verticalAlign: -2, marginRight: 6 }} aria-hidden="true" />
            {exporting ? 'Preparing…' : 'Export all orders'}
          </button>
          <button className="btn primary" type="button" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : (scopeProfile?.can_create_resellers ? '+ New account' : '+ New customer')}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={createSub} className="cust-create-form">
          <h3 className="cust-form-title">
            {form.account_type === 'reseller' ? 'Create reseller account' : 'Create customer account'}
          </h3>

          {scopeProfile?.can_create_resellers && (
            <div className="field mt-type-field">
              <label>Account type</label>
              <div className="mt-type">
                <button type="button"
                  className={'mt-type-opt' + (form.account_type !== 'reseller' ? ' on' : '')}
                  onClick={() => setForm({ ...form, account_type: 'customer' })}
                  aria-pressed={form.account_type !== 'reseller'}>
                  <span className="mt-type-radio" aria-hidden="true" />
                  <span>
                    <span className="mt-type-t">Customer</span>
                    <span className="mt-type-d">Buys and manages their own certificates</span>
                  </span>
                </button>
                <button type="button"
                  className={'mt-type-opt' + (form.account_type === 'reseller' ? ' on' : '')}
                  onClick={() => setForm({ ...form, account_type: 'reseller' })}
                  aria-pressed={form.account_type === 'reseller'}>
                  <span className="mt-type-radio" aria-hidden="true" />
                  <span>
                    <span className="mt-type-t">Reseller</span>
                    <span className="mt-type-d">Can create and manage their own customers</span>
                  </span>
                </button>
              </div>
            </div>
          )}

          <div className="field-row">
            <div className="field">
              <label htmlFor="cname">Full name</label>
              <input id="cname" required placeholder="Acme Corp / John Smith" autoFocus
                value={form.full_name} onChange={set('full_name')} />
            </div>
            <div className="field">
              <label htmlFor="ccompany">Company name</label>
              <input id="ccompany" type="text" placeholder="Company name (optional)"
                value={form.company_name} onChange={set('company_name')} />
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

      {(() => {
        const q = search.trim().toLowerCase()
        const match = (c) => !q
          || (c.full_name || '').toLowerCase().includes(q)
          || (c.customer_code || '').toLowerCase().includes(q)
          || (c.email || '').toLowerCase().includes(q)
          || (c.company_name || '').toLowerCase().includes(q)

        const all = (subs || []).filter(match)
        const resellers = all.filter((c) => c.account_type === 'reseller')
        const customers = all.filter((c) => c.account_type !== 'reseller')

        const renderRow = (c) => {
          const co = orders.filter(o => o.user_id === c.id)
          const activated = co.filter(o => deliverables(o).activated).length
          const pending = co.length - activated
          const joined = new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

          return (
            <div className="cust-row-v2" key={c.id}>
              <div className="cust-avatar-sm">{(c.full_name || '?')[0].toUpperCase()}</div>
              <div className="cust-info">
                <div className="cust-info-top">
                  <span className="cust-name-v2">{c.full_name || 'Unnamed customer'}</span>
                  {c.account_type === 'reseller' && (
                    <span className="acct-badge acct-reseller" title="Can create and manage their own customers">Reseller</span>
                  )}
                  {c.customer_code && <span className="cust-code">{c.customer_code}</span>}
                  {c.company_name && <span className="cust-company-v2">{c.company_name}</span>}
                </div>
                <div className="cust-info-sub">
                  {c.email && <span className="cust-email-v2">{c.email}</span>}
                  <span className="cust-joined-v2">Joined {joined}</span>
                </div>
              </div>
              <div className="cust-stats-v2">
                <span className="cust-stat-v2"><strong>{co.length}</strong> plans</span>
                <span className={'cust-stat-v2' + (pending > 0 ? ' warn' : '')}><strong>{pending}</strong> pending</span>
                <span className={'cust-stat-v2' + (activated > 0 ? ' ok' : '')}><strong>{activated}</strong> automated</span>
              </div>
              <div className="cust-row-actions-v2">
                <button type="button" className="btn ghost" style={{ fontSize: '0.78rem', padding: '6px 13px' }}
                  onClick={() => openEdit(c)}>Edit</button>
                {c.account_type !== 'reseller' && (
                  <Link to={`/order-for/${c.id}`} className="btn primary" style={{ fontSize: '0.78rem', padding: '6px 13px', textDecoration:'none' }}>+ Buy plan</Link>
                )}
                <Link to={c.account_type === 'reseller' ? `/dashboard/as/${c.id}/customers` : `/dashboard/as/${c.id}`}
                  className="btn ghost" style={{ fontSize: '0.78rem', padding: '6px 13px', textDecoration:'none' }}>
                  {c.account_type === 'reseller' ? 'Login as reseller' : 'Login as customer'}</Link>
              </div>
            </div>
          )
        }

        return (
          <>
            {resellers.length > 0 && (
              <section className="cust-section">
                <div className="cust-section-head">
                  <span className="cust-section-t">Resellers</span>
                  <span className="cust-section-n">{resellers.length}</span>
                  <span className="cust-section-d">Manage their own customers</span>
                </div>
                <Stagger className="cust-list" step={70}>
                  {resellers.map(renderRow)}
                </Stagger>
              </section>
            )}

            <section className="cust-section">
              <div className="cust-section-head">
                <span className="cust-section-t">{resellers.length > 0 ? 'Direct customers' : 'Customers'}</span>
                <span className="cust-section-n">{customers.length}</span>
                <span className="cust-section-d">Buy and manage their own certificates</span>
              </div>
              <Stagger className="cust-list" step={70}>
                {customers.map(renderRow)}
              </Stagger>
            </section>
          </>
        )
      })()}

      {editMsg && <div className="alert ok" style={{ marginTop: 12 }}>{editMsg}</div>}

      {edit && (
        <div className="ce-backdrop" onClick={(ev) => { if (ev.target === ev.currentTarget) setEdit(null) }}>
          <form className="ce-modal" onSubmit={saveEdit}>
            <div className="ce-head">
              <span className="ce-title">Edit customer</span>
              <button type="button" className="ce-x" onClick={() => setEdit(null)} aria-label="Close">×</button>
            </div>
            <div className="ce-body">
              <label className="ce-f"><span>First and last name</span>
                <input value={edit.full_name} onChange={setE('full_name')} placeholder="Jane Smith" />
              </label>
              <label className="ce-f"><span>Company <i>optional</i></span>
                <input value={edit.company_name} onChange={setE('company_name')} placeholder="Acme Ltd" />
              </label>
              <label className="ce-f"><span>Email address</span>
                <input type="email" value={edit.email} onChange={setE('email')} required />
                <small>Changing this changes the address they sign in with.</small>
              </label>
              <label className="ce-f"><span>New password <i>optional</i></span>
                <input type="text" value={edit.password} onChange={setE('password')}
                  placeholder="Leave blank to keep the current password" autoComplete="new-password" />
                <small>At least 8 characters. They are not told automatically — you will need to pass it on.</small>
              </label>
              {editErr && <div className="alert error" style={{ margin: 0 }}>{editErr}</div>}
            </div>
            <div className="ce-foot">
              <button type="button" className="btn ghost" onClick={() => setEdit(null)} disabled={editBusy}>Cancel</button>
              <button type="submit" className="btn primary" disabled={editBusy}>{editBusy ? 'Saving…' : 'Save changes'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
