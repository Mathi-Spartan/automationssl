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

  useEffect(() => {
    if (!session?.user) return
    supabase.from('profiles').select('id, full_name, parent_reseller_id')
      .eq('id', customerId).single()
      .then(({ data }) => {
        if (!data || data.parent_reseller_id !== session.user.id) setNotFound(true)
        else {
          setCustomer(data)
          setForm(f => ({ ...f, email: '' }))
        }
      })
  }, [session?.user?.id, customerId])

  if (loading || (session && !profile)) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: `/order-for/${customerId}` }} />
  if (profile?.account_type !== 'reseller') return <Navigate to="/dashboard" replace />
  if (notFound) return <div className="form-page"><div className="alert error">Customer not found or not in your account.</div><Link to="/dashboard" className="btn ghost">Back</Link></div>

  const set = k => e => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  async function submit(e) {
    e.preventDefault()
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
          for_customer_id: customerId,
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
              <div className="wizard-card-title">Order placed for {customer?.full_name}</div>
              <div className="wizard-card-sub">The plan is now active in their dashboard.</div>
            </div>
          </div>
          <div className="wizard-meta-grid">
            <div><span className="wizard-meta-label">Order ID</span><span className="wizard-meta-val mono">{result.order_id}</span></div>
            <div><span className="wizard-meta-label">Plan</span><span className="wizard-meta-val">{selectedPlan?.name}</span></div>
            <div><span className="wizard-meta-label">Domain</span><span className="wizard-meta-val">{form.domain}</span></div>
            <div><span className="wizard-meta-label">Customer</span><span className="wizard-meta-val">{customer?.full_name}</span></div>
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
      <h1>Buy a plan for {customer?.full_name || '…'}</h1>
      <p className="sub">This plan will be placed directly into {customer?.full_name || 'this customer'}'s account and appear in their dashboard immediately.</p>

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
            <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%', padding: '14px' }}>
              {busy ? 'Placing order…' : `Place order for ${customer?.full_name || 'customer'} →`}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
