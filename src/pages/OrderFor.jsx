import React, { useEffect, useState } from 'react'
import { useParams, Link, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { PRODUCTS } from '../catalog.js'

export default function OrderFor() {
  const { customerId } = useParams()
  const { session, profile, loading } = useAuth()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState(null)
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [form, setForm] = useState({ domain: '', email: '', firstname: '', lastname: '', phone: '', period: 12 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [notFound, setNotFound] = useState(false)

  const isStock = customerId === 'stock'

  // On the stock page the reseller can send the order to a customer instead.
  const [dest, setDest] = useState('stock')        // 'stock' | 'customer'
  const [destId, setDestId] = useState('')
  const [myCustomers, setMyCustomers] = useState([])

  useEffect(() => {
    if (!session?.user || !isStock) return
    let alive = true
    supabase.from('profiles')
      .select('id, full_name, customer_code, email')
      .eq('parent_reseller_id', session.user.id)
      // Certificates go to retail customers only. A sub-reseller buys for
      // their own customers; holding a plan themselves has no meaning.
      .eq('account_type', 'customer')
      .order('created_at')
      .then(({ data }) => { if (alive) setMyCustomers(data || []) })
    return () => { alive = false }
  }, [session?.user?.id, isStock])

  // effective target: the route's customer, or the one picked on the stock page
  const targetId = isStock ? (dest === 'customer' ? destId : null) : customerId
  const targetName = isStock
    ? (myCustomers.find((c) => c.id === destId)?.full_name || 'a customer')
    : (customer?.full_name || 'this customer')
  const toStock = isStock && dest === 'stock'

  useEffect(() => {
    if (!session?.user || isStock) return
    supabase.from('profiles').select('id, full_name, parent_reseller_id')
      .eq('id', customerId).single()
      .then(({ data }) => {
        if (!data || data.parent_reseller_id !== session.user.id) setNotFound(true)
        else {
          setCustomer(data)
          setForm(f => ({ ...f, email: '' }))
        }
      })
  }, [session?.user?.id, customerId, isStock])

  if (loading || (session && !profile)) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: `/order-for/${customerId}` }} />
  if (profile?.account_type !== 'reseller') return <Navigate to="/dashboard" replace />
  if (notFound) return <div className="form-page"><div className="alert error">Customer not found or not in your account.</div><Link to="/dashboard" className="btn ghost">Back</Link></div>

  const set = k => e => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  async function submit(e) {
    e.preventDefault()
    // Guard the UI-disabled case: a form can still submit via Enter, and an
    // empty destId would silently send the order to inventory while the page
    // says it is going to a customer.
    if (isStock && dest === 'customer' && !destId) {
      setError({ message: 'Choose a customer, or switch to My inventory.' })
      return
    }
    if (!selectedPlan) { setError({ message: 'Please select a plan.' }); return }
    setBusy(true); setError(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
        body: JSON.stringify({
          product_id: selectedPlan.id,
          period: Number(form.period),
          domain: form.domain.trim(),
          email: form.email.trim(),
          firstname: form.firstname.trim(),
          lastname: form.lastname.trim(),
          phone: form.phone.trim(),
          ...(targetId ? { for_customer_id: targetId } : {}),
        }),
      })
      const body = await res.json()
      if (!res.ok || body.error) { setError(body); return }
      setResult(body)
    } finally { setBusy(false) }
  }

  if (result) {
    return (
      <div className="form-page">
        <div className="wizard-card wizard-card-done" style={{ marginBottom: 16 }}>
          <div className="wizard-card-head">
            <span className="wizard-check">✓</span>
            <div>
              <div className="wizard-card-title">{toStock ? 'Order placed to your stock' : `Order placed for ${targetName}`}</div>
              <div className="wizard-card-sub">{toStock ? 'The plan is in My inventory — assign it to any customer from the dashboard.' : 'The plan is now active in their dashboard.'}</div>
            </div>
          </div>
          <div className="wizard-meta-grid">
            <div><span className="wizard-meta-label">Order ID</span><span className="wizard-meta-val mono">{result.order_id}</span></div>
            <div><span className="wizard-meta-label">Plan</span><span className="wizard-meta-val">{selectedPlan?.name}</span></div>
            <div><span className="wizard-meta-label">Domain</span><span className="wizard-meta-val">{form.domain}</span></div>
            <div><span className="wizard-meta-label">{isStock ? 'Destination' : 'Customer'}</span><span className="wizard-meta-val">{isStock ? 'My inventory' : customer?.full_name}</span></div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="btn primary" to="/dashboard">Back to dashboard →</Link>
          <button className="btn ghost" type="button" onClick={() => { setResult(null); setSelectedPlan(null) }}>Place another order</button>
        </div>
      </div>
    )
  }

  return (
    <div className="form-page">
      <span className="eyebrow">Reseller order</span>
      <h1>{toStock ? 'Buy a plan for your stock' : `Buy a plan for ${targetName}`}</h1>
      <p className="sub">{toStock
        ? 'This plan will be placed into My inventory — assign it to any customer afterwards.'
        : `This plan will be placed directly into ${targetName}'s account and appear in their dashboard immediately.`}</p>

      {isStock && (
        <div className="of-dest">
          <div className="of-dest-label">Where should this plan go?</div>
          <div className="of-dest-opts">
            <button type="button" className={'of-dest-opt' + (dest === 'stock' ? ' on' : '')}
              onClick={() => setDest('stock')} aria-pressed={dest === 'stock'}>
              <span className="of-dest-radio" aria-hidden="true" />
              <span>
                <span className="of-dest-t">My inventory</span>
                <span className="of-dest-d">Assign it to a customer later</span>
              </span>
            </button>
            <button type="button" className={'of-dest-opt' + (dest === 'customer' ? ' on' : '')}
              onClick={() => setDest('customer')} aria-pressed={dest === 'customer'}
              disabled={myCustomers.length === 0}>
              <span className="of-dest-radio" aria-hidden="true" />
              <span>
                <span className="of-dest-t">A customer</span>
                <span className="of-dest-d">
                  {myCustomers.length === 0 ? 'No customers yet' : 'Goes straight to their dashboard'}
                </span>
              </span>
            </button>
          </div>
          {dest === 'customer' && (
            <div className="of-dest-pick">
              <select value={destId} onChange={(e) => setDestId(e.target.value)}>
                <option value="">— choose a customer —</option>
                {myCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name || c.email || 'Unnamed'}{c.customer_code ? ` · ${c.customer_code}` : ''}
                  </option>
                ))}
              </select>
              <p className="of-dest-hint">
                Assignment is permanent — the plan cannot be moved to a different customer afterwards.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Plan picker */}
      {!selectedPlan ? (
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12, color: '#0a2540' }}>Select a plan</h2>
          <div className="of-plan-grid">
            {PRODUCTS.map(p => (
              <button key={p.id} type="button" className="of-plan-card" onClick={() => { setSelectedPlan(p); setForm(f => ({ ...f, period: p.periods[0] })) }}>
                <div className="of-plan-name">{p.name}</div>
                <div className="of-plan-meta">{p.coverage} · DV</div>
                <div className="of-plan-price">{p.price}<span style={{ fontSize: '0.72rem', color: '#9aa8b5', marginLeft: 4 }}>{p.priceNote}</span></div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="of-selected-plan">
            <span className="of-plan-name">{selectedPlan.name}</span>
            <span className="of-plan-meta">{selectedPlan.coverage}</span>
            <button type="button" className="of-change-btn" onClick={() => setSelectedPlan(null)}>Change plan</button>
          </div>

          <form onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="of-domain">Primary domain</label>
              <input id="of-domain" required placeholder={selectedPlan.coverage.startsWith('Wildcard') ? '*.example.com' : 'www.example.com'}
                value={form.domain} onChange={set('domain')} />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="of-fn">First name</label>
                <input id="of-fn" required value={form.firstname} onChange={set('firstname')} autoComplete="given-name" />
              </div>
              <div className="field">
                <label htmlFor="of-ln">Last name</label>
                <input id="of-ln" required value={form.lastname} onChange={set('lastname')} autoComplete="family-name" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="of-email">Contact email</label>
                <input id="of-email" type="email" required value={form.email} onChange={set('email')} />
                <p className="hint">Used for CA communication — can be the customer's or yours.</p>
              </div>
              <div className="field">
                <label htmlFor="of-phone">Phone</label>
                <input id="of-phone" type="tel" required value={form.phone} onChange={set('phone')} placeholder="+31 6 12345678" />
              </div>
            </div>
            {error && <div className="alert error" role="alert"><strong>{error.message || 'Order failed.'}</strong></div>}
            <button className="btn primary" type="submit" disabled={busy || (isStock && dest === 'customer' && !destId)} style={{ width: '100%', padding: '14px' }}>
              {busy ? 'Placing order…' : toStock ? 'Place order to my stock →' : (isStock && !destId) ? 'Choose a customer first' : `Place order for ${targetName} →`}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
