import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { deliverables } from './Dashboard.jsx'
import ExportRange from '../components/ExportRange.jsx'
import { PRODUCTS } from '../catalog.js'
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
  // list and cost per product, straight from resolve_price so this panel
  // cannot drift from what the order API actually charges.
  const [priceRows, setPriceRows] = useState([])
  const [orders, setOrders] = useState([])
  const [form, setForm] = useState({ email: '', password: '', full_name: '', company_name: '', account_type: 'customer', markup_pct: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [edit, setEdit] = useState(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editMsg, setEditMsg] = useState(null)
  const [editErr, setEditErr] = useState(null)
  const [search, setSearch] = useState('')
  // These two must stay here. React requires hooks to run in the same order on
  // every render; declared below the early returns at line ~52 they are skipped
  // whenever a guard fires, and the next render throws "Rendered more hooks
  // than during the previous render" — which blanks the page.
  const [exporting, setExporting] = useState(false)
  // scopeProfile comes from useAuth() and is cached at sign-in, so it never
  // reflects a slab saved in this session. Hold the live values locally.
  const [slabs, setSlabs] = useState({ discount_pct: null, markup_pct: null })

  async function reload() {
    // Fetch children first, then their orders by explicit id. Using
    // .neq(scopeId) would return the VIEWER's other customers' orders while
    // impersonating, because the session is still the viewer's.
    const p = await supabase.from('profiles')
      .select('id, full_name, created_at, customer_code, email, company_name, account_type, can_create_resellers, discount_pct, markup_pct')
      .eq('parent_reseller_id', scopeId).order('created_at')
    const ids = (p.data || []).map((c) => c.id)
    const o = ids.length
      ? await supabase.from('orders')
          .select('id, user_id, product_name, product_id, api_response, assigned_at, status')
          .in('user_id', ids)
      : { data: [] }
    const { data: me } = await supabase.from('profiles')
      .select('discount_pct, markup_pct').eq('id', scopeId).maybeSingle()
    setSlabs({ discount_pct: me?.discount_pct ?? null, markup_pct: me?.markup_pct ?? null })
    setSubs(p.data || [])
    setOrders(o.data || [])
    setErr(p.error?.message || null)
  }

  useEffect(() => {
    if (scopeId && scopeProfile?.account_type === 'reseller') reload()
  }, [scopeId, scopeProfile?.account_type])

  useEffect(() => {
    if (!scopeId || scopeProfile?.account_type !== 'reseller') return
    let alive = true
    Promise.all(PRODUCTS.map((p) =>
      supabase.rpc('resolve_price', { buyer: scopeId, prod: p.id })
        .then(({ data }) => ({ id: p.id, name: p.name, unit: p.priceNote, ...(data?.[0] || {}) }))))
      .then((rows) => { if (alive) setPriceRows(rows) })
    return () => { alive = false }
  }, [scopeId, scopeProfile?.account_type, slabs.discount_pct])

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
        // Without parent_id the API attaches the account to the token holder,
        // which is the master when drilled into a sub-reseller's page.
        body: JSON.stringify({
          ...form,
          // Only a sub-reseller's customers carry a markup; sending it for a
          // reseller account or a master's customer would be refused.
          markup_pct: canOverrideMarkup && form.account_type !== 'reseller' && form.markup_pct !== ''
            ? Number(form.markup_pct) : undefined,
          ...(viewAs?.id ? { parent_id: viewAs.id } : {}),
        }),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.message || 'Could not create the account.')
      setMsg(`Account created for ${form.email}. Share these credentials with your customer — they can sign in right away.`)
      setForm({ email: '', password: '', full_name: '', company_name: '', account_type: 'customer', markup_pct: '' })
      setShowForm(false)
      reload()
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value })

  // A master's direct customers always pay list, so an override is only
  // meaningful one level down.
  const canOverrideMarkup =
    scopeProfile?.account_type === 'reseller' && !scopeProfile?.can_create_resellers

  function openEdit(c) {
    setEditErr(null); setEditMsg(null)
    setEdit({
      id: c.id,
      full_name: c.full_name || '',
      company_name: c.company_name || '',
      email: c.email || '',
      password: '',
      account_type: c.account_type || 'customer',
      discount_pct: c.discount_pct ?? '',
      markup_pct: c.markup_pct ?? '',
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
      if (edit.account_type === 'reseller') {
        payload.discount_pct = edit.discount_pct === '' ? null : Number(edit.discount_pct)
      } else if (canOverrideMarkup) {
        payload.markup_pct = edit.markup_pct === '' ? null : Number(edit.markup_pct)
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


  /* Export every order beneath this account at any depth: direct customers,
     sub-resellers, and those sub-resellers' own customers. RLS already limits
     what is readable to the caller's subtree, so a broad select cannot leak. */
  async function exportAll(range) {
    setExporting(true)
    try {
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

      const ids = [scopeId, ...tree.map((t) => t.id)]
      let { data: ords } = ids.length
        ? await supabase.from('orders')
            .select('id, user_id, product_name, product_id, api_response, assigned_at, created_at, status, bill_price, sale_price')
            .in('user_id', ids)
        : { data: [] }

      const byParent = {}
      tree.forEach((t) => {
        const k = t.parent_reseller_id
        if (!byParent[k]) byParent[k] = []
        byParent[k].push(t)
      })
      // Previously unfiltered: the sheet was stamped with the current month
      // and then contained every order ever placed, which would overbill a
      // sub-reseller the moment there was more than one month of history.
      if (range?.from && range?.to) {
        ords = (ords || []).filter((o) => {
          const d = new Date(o.created_at)
          return d >= range.from && d <= range.to
        })
      }

      const ordersFor = (id) => (ords || []).filter((o) => o.user_id === id)

      const period = range?.label || 'All time'
      const money = (v) => (v == null ? '—' : Number(v).toFixed(2))

      // ── Sub-reseller statement ──────────────────────────────────────────
      // A different question from the master's. The master asks "what do I
      // invoice this account?" and answers with bill_price. A sub-reseller asks
      // "what does each of MY customers owe ME?", which is sale_price, with
      // bill_price alongside so they can see the margin they actually earned.
      // Both numbers are read off the order row, never recomputed from current
      // slabs — margin now varies per customer, and a slab or override changed
      // next month must not rewrite last month's statement.
      if (scopeProfile?.can_create_resellers !== true) {
        const RCOLS = 11
        const rrows = []
        const rpush = (cells) => { rrows.push(cells) }
        const rblank = () => rpush(Array(RCOLS).fill(''))
        const RHEAD = ['Customer', 'ID', 'Company', 'Order #', 'Product', 'Domain(s)',
                       'Status', 'Renews', 'You paid', 'They paid', 'Your margin']

        rpush([`BILLING STATEMENT — ${(scopeProfile?.full_name || 'Account').toUpperCase()}`,
               ...Array(RCOLS - 1).fill('')])
        rpush([`Period: ${period}`, '', '', '', '', '',
               `Generated ${new Date().toLocaleDateString('en-GB')}`, ...Array(RCOLS - 7).fill('')])
        rblank()

        let gOrders = 0, gCost = 0, gSale = 0

        const myOwn = ordersFor(scopeId)
        if (myOwn.length) {
          rpush(['══ YOUR OWN INVENTORY ══', ...Array(RCOLS - 1).fill('')])
          rpush(RHEAD)
          let cost = 0
          myOwn.forEach((o, i) => {
            const d = deliverables(o)
            rpush([
              i === 0 ? 'Bought for your stock' : '', '', '',
              o.api_response?.order?.order_id || o.id?.slice(0, 8) || '',
              o.product_name || '',
              (d.vendorDomains || []).map((x) => (typeof x === 'string' ? x : x?.name || '')).filter(Boolean).join(', '),
              d.activated ? 'Automated' : 'Needs setup',
              d.renewal ? new Date(d.renewal).toLocaleDateString('en-GB') : '',
              money(o.bill_price), '—', '—',
            ], 'order')
            cost += Number(o.bill_price || 0)
          })
          gOrders += myOwn.length; gCost += cost
          rpush(['   Subtotal · your own inventory', '', '',
                 `${myOwn.length} order${myOwn.length === 1 ? '' : 's'}`, '', '', '', '',
                 cost.toFixed(2), '—', '—'])
          rblank()
        }

        const myCustomers = (byParent[scopeId] || []).filter((a) => a.account_type !== 'reseller')
        myCustomers.forEach((c) => {
          rpush([`══ CUSTOMER: ${(c.full_name || 'Unnamed').toUpperCase()} ══`, c.customer_code || '',
                 c.company_name || '', ...Array(RCOLS - 3).fill('')])
          rpush(RHEAD)
          const mine = ordersFor(c.id)
          if (!mine.length) {
            rpush([c.full_name || 'Unnamed', c.customer_code || '', c.company_name || '',
                   '—', 'No orders this period', ...Array(RCOLS - 5).fill('')])
            rblank()
            return
          }
          let cost = 0, sale = 0
          mine.forEach((o, i) => {
            const d = deliverables(o)
            const b = o.bill_price == null ? null : Number(o.bill_price)
            const s = o.sale_price == null ? null : Number(o.sale_price)
            rpush([
              i === 0 ? (c.full_name || 'Unnamed') : '',
              i === 0 ? (c.customer_code || '') : '',
              i === 0 ? (c.company_name || '') : '',
              o.api_response?.order?.order_id || o.id?.slice(0, 8) || '',
              o.product_name || '',
              (d.vendorDomains || []).map((x) => (typeof x === 'string' ? x : x?.name || '')).filter(Boolean).join(', '),
              d.activated ? 'Automated' : 'Needs setup',
              d.renewal ? new Date(d.renewal).toLocaleDateString('en-GB') : '',
              money(b), money(s),
              b == null || s == null ? '—' : (s - b).toFixed(2),
            ], 'order')
            cost += b || 0; sale += s || 0
          })
          gOrders += mine.length; gCost += cost; gSale += sale
          rpush([`   Subtotal · ${c.full_name || 'customer'}`, '', '',
                 `${mine.length} order${mine.length === 1 ? '' : 's'}`, '', '', '', '',
                 cost.toFixed(2), sale.toFixed(2), (sale - cost).toFixed(2)])
          rblank()
        })

        rpush(['══ TOTAL · ALL CUSTOMERS ══', '', '',
               `${gOrders} order${gOrders === 1 ? '' : 's'}`, '', '', '', 'USD',
               gCost.toFixed(2), gSale.toFixed(2), (gSale - gCost).toFixed(2)])
        rpush(['You paid = what you owe your provider. They paid = what to invoice your customer.',
               ...Array(RCOLS - 1).fill('')])
        rpush(['Prices as recorded at time of order. A later slab or override change does not alter past orders.',
               ...Array(RCOLS - 1).fill('')])

        const rws = XLSX.utils.aoa_to_sheet(rrows)
        rws['!cols'] = [{ wch: 26 }, { wch: 11 }, { wch: 20 }, { wch: 12 }, { wch: 34 },
                        { wch: 24 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 13 }]
        const rwb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(rwb, rws, 'Customer billing')
        XLSX.writeFile(rwb, `customer-billing-${new Date().toISOString().slice(0, 10)}.xlsx`)
        return
      }

      const COLS = 9
      const rows = []
      const style = []

      const push = (cells, type) => { style.push({ r: rows.length, type }); rows.push(cells) }
      const blank = () => push(Array(COLS).fill(''), 'blank')

      push([`BILLING STATEMENT — ${(scopeProfile?.full_name || 'Account').toUpperCase()}`, '', '', '', '', '', '', '', ''], 'title')
      push([`Period: ${period}`, '', '', '', '', '', `Generated ${new Date().toLocaleDateString('en-GB')}`, '', ''], 'meta')
      blank()

      const HEAD = ['Account', 'ID', 'Company', 'Order #', 'Product', 'Domain(s)', 'Status', 'Renews', 'Billed (USD)']
      let grandOrders = 0
      let grandValue = 0
      let sectionTotal = 0

      // Indent conveys depth: Excel has no tree view, so the hierarchy has to
      // survive as leading space in the first column.
      const writeAccount = (acct, indent) => {
        const pad = indent ? '      └─ ' : ''
        const mine = ordersFor(acct.id)
        grandOrders += mine.length
        if (!mine.length) {
          push([`${pad}${acct.full_name || 'Unnamed'}`, acct.customer_code || '',
                acct.company_name || '', '—', 'No orders this period', '', '', '', ''], 'empty')
          return 0
        }
        mine.forEach((o, i) => {
          const d = deliverables(o)
          const doms = (d.vendorDomains || [])
            .map((x) => (typeof x === 'string' ? x : x?.name || ''))
            .filter(Boolean).join(', ')
          push([
            i === 0 ? `${pad}${acct.full_name || 'Unnamed'}` : '',
            i === 0 ? (acct.customer_code || '') : '',
            i === 0 ? (acct.company_name || '') : '',
            o.api_response?.order?.order_id || o.id?.slice(0, 8) || '',
            o.product_name || '',
            doms,
            d.activated ? 'Automated' : 'Needs setup',
            d.renewal ? new Date(d.renewal).toLocaleDateString('en-GB') : '',
            o.bill_price != null ? Number(o.bill_price).toFixed(2) : '—',
          ], 'order')
          sectionTotal += Number(o.bill_price || 0)
        })
        return mine.length
      }

      const direct = byParent[scopeId] || []
      const retail = direct.filter((a) => a.account_type !== 'reseller')
      const resellers = direct.filter((a) => a.account_type === 'reseller')

      if (retail.length) {
        push(['══ DIRECT CUSTOMERS ══', '', '', '', '', '', '', '', ''], 'section')
        push(HEAD, 'header')
        let n = 0
        retail.forEach((a) => { n += writeAccount(a, 0) })
        push(['   Subtotal · direct customers', '', '', `${n} order${n === 1 ? '' : 's'}`, '', '', '', '', sectionTotal.toFixed(2)], 'subtotal')
        grandValue += sectionTotal; sectionTotal = 0
        blank()
      }

      resellers.forEach((r) => {
        push([`══ RESELLER: ${(r.full_name || 'Unnamed').toUpperCase()} ══`, r.customer_code || '',
              r.company_name || '', '', '', '', '', '', ''], 'section')
        push(HEAD, 'header')
        let n = writeAccount(r, 0)
        ;(byParent[r.id] || []).forEach((c) => { n += writeAccount(c, 1) })
        push([`   Subtotal · ${r.full_name || 'reseller'} and their customers`, '', '', `${n} order${n === 1 ? '' : 's'}`, '', '', '', '', sectionTotal.toFixed(2)], 'subtotal')
        grandValue += sectionTotal; sectionTotal = 0
        blank()
      })

      push([`══ TOTAL · ALL ACCOUNTS ══`, '', '', `${grandOrders} order${grandOrders === 1 ? '' : 's'}`, '', '', '', 'USD', grandValue.toFixed(2)], 'total')
      push(['Prices as recorded at time of order. A later slab change does not alter past orders.', '', '', '', '', '', '', '', ''], 'meta')

      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [{ wch: 30 }, { wch: 11 }, { wch: 20 }, { wch: 12 },
                     { wch: 34 }, { wch: 26 }, { wch: 13 }, { wch: 12 }, { wch: 12 }]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Billing statement')
      XLSX.writeFile(wb, `automationssl-billing-${new Date().toISOString().slice(0, 10)}.xlsx`)
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
          <ExportRange
            onPick={exportAll}
            busy={exporting}
            disabled={!(subs || []).length}
            label={scopeProfile?.can_create_resellers ? 'Export all orders' : 'Export customer billing'} />
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
          {canOverrideMarkup && form.account_type !== 'reseller' && (
            <div className="field" style={{ marginTop: 4 }}>
              <label>Their price <span className="hint-inline">markup on your cost</span></label>
              <div className="slab-row">
                {[10, 20, 30].map((v) => (
                  <button key={v} type="button"
                    className={'slab-opt' + (String(form.markup_pct) === String(v) ? ' on' : '')}
                    onClick={() => setForm({ ...form, markup_pct: v })}>+{v}%</button>
                ))}
              </div>
              <p className="hint">
                {(() => {
                  const eg = priceRows.find((r) => Number(r.bill_price) > 0)
                  if (!eg || form.markup_pct === '') {
                    return 'Set this now or the customer cannot place an order. You can change it later.'
                  }
                  const cost = Number(eg.bill_price)
                  const list = Number(eg.list_price)
                  const charged = Math.min(cost * (1 + Number(form.markup_pct) / 100), list)
                  return `On ${eg.name} they would pay $${charged.toFixed(2)}, leaving you $${(charged - cost).toFixed(2)}.`
                })()}
              </p>
            </div>
          )}
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
                  {c.account_type === 'reseller' && (
                    <span className={'acct-badge ' + (c.discount_pct ? 'acct-slab' : 'acct-slab-none')}
                      title={c.discount_pct
                        ? `Buys at list price less ${c.discount_pct}%`
                        : 'No discount slab set — they cannot place orders until you set one'}>
                      {c.discount_pct ? `${c.discount_pct}% off` : 'No slab set'}
                    </span>
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
              {edit.account_type === 'reseller' && (
                <div className="ce-f">
                  <span>Discount slab <i>what they pay you</i></span>
                  <div className="slab-row">
                    {['', 40, 50, 60].map((v) => (
                      <button key={String(v)} type="button"
                        className={'slab-opt' + (String(edit.discount_pct) === String(v) ? ' on' : '')}
                        onClick={() => setEdit({ ...edit, discount_pct: v })}>
                        {v === '' ? 'Not set' : `${v}% off`}
                      </button>
                    ))}
                  </div>
                  <small>
                    Applies to every product. They buy at list price minus this slab; a bigger
                    slab lets them mark up further without exceeding your public price.
                  </small>
                </div>
              )}
              {edit.account_type !== 'reseller' && canOverrideMarkup && (
                <div className="ce-f">
                  <span>Their price <i>markup on your cost</i></span>
                  <div className="slab-row">
                    {['', 10, 20, 30].map((v) => (
                      <button key={String(v)} type="button"
                        className={'slab-opt' + (String(edit.markup_pct) === String(v) ? ' on' : '')}
                        onClick={() => setEdit({ ...edit, markup_pct: v })}>
                        {v === '' ? 'Not set' : `+${v}%`}
                      </button>
                    ))}
                  </div>
                  <small>
                    {(() => {
                      const eg = priceRows.find((r) => Number(r.bill_price) > 0)
                      const mk = edit.markup_pct === '' ? null : Number(edit.markup_pct)
                      if (!eg || mk == null) {
                        return 'Without a markup this customer cannot order. Never charged above the public list price.'
                      }
                      const cost = Number(eg.bill_price)
                      const list = Number(eg.list_price)
                      const charged = Math.min(cost * (1 + mk / 100), list)
                      return (
                        <>
                          On {eg.name} they would
                          pay <b>${charged.toFixed(2)}</b>, leaving you <b>${(charged - cost).toFixed(2)}</b>.
                          Never charged above the ${list.toFixed(2)} list price.
                        </>
                      )
                    })()}
                  </small>
                </div>
              )}

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
