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
    agree: false,
  })
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
          {result.autoinstall && result.autoinstall.setup_link && (
            <div style={{ marginTop: 14 }}>
              <p><strong>Next step — set up your automation agent.</strong> Open your personal
              setup portal below to connect your server. Issuance and renewals run
              automatically after that.</p>
              <a className="btn primary" style={{ display: 'inline-block', marginTop: 10 }} href={result.autoinstall.setup_link} target="_blank" rel="noreferrer">
                Open setup portal →
              </a>
              <p className="hint" style={{ fontSize: '0.8rem', marginTop: 8 }}>
                This link is personal to your plan — save it somewhere safe and do not share it.
              </p>
            </div>
          )}
          {result.acme && (
            <div style={{ marginTop: 14 }}>
              <p><strong>Your ACME enrollment credentials</strong> — use these with certbot,
              acme.sh, Caddy or any ACME client. Save them now; treat them like a password.</p>
              <pre>{JSON.stringify(result.acme, null, 2)}</pre>
            </div>
          )}
          <p style={{ marginTop: 10 }}>
            You can retrieve these details anytime on the{' '}
            <Link to="/status" style={{ textDecoration: 'underline' }}>order status page</Link>{' '}
            using your Order ID and the email above. Keep your Order ID safe.
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
