import { useState } from 'react'
import { useParams, Navigate, Link } from 'react-router-dom'
import { bySlug } from '../catalog.js'

export default function Order() {
  const { slug } = useParams()
  const p = bySlug(slug)
  const [form, setForm] = useState({
    domain: '',
    email: '',
    firstname: '',
    lastname: '',
    phone: '',
    period: p ? p.periods[0] : 12,
    csr: '',
    agree: false,
  })
  const [showCsr, setShowCsr] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  if (!p) return <Navigate to="/" replace />

  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (!form.agree) {
      setError({ message: `Please accept the ${p.brand} subscriber agreement to continue.` })
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: p.id,
          period: Number(form.period),
          domain: form.domain.trim(),
          email: form.email.trim(),
          firstname: form.firstname.trim(),
          lastname: form.lastname.trim(),
          phone: form.phone.trim(),
          csr: form.csr.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data)
      } else {
        setResult(data)
        window.scrollTo(0, 0)
      }
    } catch (err) {
      setError({ message: 'Network error — please try again.', detail: String(err) })
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="form-page">
        <h1>Order received ✓</h1>
        <p className="sub">Your {p.name} plan has been registered.</p>
        <div className="alert ok">
          <strong>Order ID: {result.order_id ?? '—'}</strong>
          <div className="kv" style={{ marginTop: 12 }}>
            <div><b>Plan</b> {p.name}</div>
            <div><b>Domain</b> {form.domain || '—'}</div>
            <div><b>Term</b> {form.period} months</div>
            <div><b>Contact</b> {form.email}</div>
          </div>
          <p style={{ marginTop: 10 }}>
            Your enrollment credentials and next steps will be available on the{' '}
            <Link to="/status" style={{ textDecoration: 'underline' }}>order status page</Link>{' '}
            and sent to your email. Keep your Order ID safe.
          </p>
        </div>
        <Link className="btn ghost" to="/">Back to plans</Link>
      </div>
    )
  }

  return (
    <div className="form-page">
      <span className="eyebrow">Free order — testing phase</span>
      <h1>Order {p.name}</h1>
      <p className="sub">{p.tagline}</p>

      <div className="order-summary">
        <div className="row"><span>Plan</span><span>{p.name}</span></div>
        <div className="row"><span>Coverage</span><span>{p.coverage}</span></div>
        <div className="row"><span>Term</span><span>{form.period} months</span></div>
        <div className="row total"><span>Total today</span><span>$0.00</span></div>
      </div>

      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="domain">Primary domain</label>
          <input id="domain" required placeholder={p.coverage.startsWith('Wildcard') ? '*.example.com' : 'www.example.com'} value={form.domain} onChange={set('domain')} />
          <p className="hint">The domain this plan will secure. For wildcard plans, use the *.domain form.</p>
        </div>

        {p.periods.length > 1 && (
          <div className="field">
            <label htmlFor="period">Plan term</label>
            <select id="period" value={form.period} onChange={set('period')}>
              {p.periods.map((m) => (
                <option key={m} value={m}>{m} months</option>
              ))}
            </select>
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="firstname">First name</label>
            <input id="firstname" required value={form.firstname} onChange={set('firstname')} autoComplete="given-name" />
          </div>
          <div className="field">
            <label htmlFor="lastname">Last name</label>
            <input id="lastname" required value={form.lastname} onChange={set('lastname')} autoComplete="family-name" />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
            <p className="hint">Order updates and enrollment credentials go here.</p>
          </div>
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input id="phone" type="tel" required value={form.phone} onChange={set('phone')} autoComplete="tel" placeholder="+31 6 12345678" />
          </div>
        </div>

        <div className="field">
          <button type="button" className="btn ghost" onClick={() => setShowCsr(!showCsr)} style={{ fontSize: '0.85rem', padding: '8px 14px' }}>
            {showCsr ? 'Hide CSR field' : 'Have your own CSR? (optional)'}
          </button>
          {showCsr && (
            <div style={{ marginTop: 12 }}>
              <textarea placeholder="-----BEGIN CERTIFICATE REQUEST-----" value={form.csr} onChange={set('csr')} spellCheck="false" />
              <p className="hint">
                Most automation plans don't need a CSR — your ACME client
                generates keys itself. Only paste one if you know you need it.
              </p>
            </div>
          )}
        </div>

        <div className="field checkbox">
          <input id="agree" type="checkbox" checked={form.agree} onChange={set('agree')} />
          <label htmlFor="agree" style={{ fontWeight: 400 }}>
            I accept the {p.brand} certificate subscriber agreement and confirm
            I control the domain above.
          </label>
        </div>

        {error && (
          <div className="alert error" role="alert">
            <strong>{error.message || 'The order could not be placed.'}</strong>
            {error.detail && <pre>{typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail, null, 2)}</pre>}
          </div>
        )}

        <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%', padding: '14px' }}>
          {busy ? 'Placing order…' : 'Place free order'}
        </button>
      </form>
    </div>
  )
}
