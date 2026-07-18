import { useState } from 'react'

export default function Status() {
  const [orderId, setOrderId] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  async function lookup(e) {
    e.preventDefault()
    setError(null)
    setData(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/status?order_id=${encodeURIComponent(orderId.trim())}&email=${encodeURIComponent(email.trim())}`)
      const body = await res.json()
      if (!res.ok || body.error) setError(body)
      else setData(body)
    } catch (err) {
      setError({ message: 'Network error — please try again.', detail: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="form-page">
      <span className="eyebrow">Order status</span>
      <h1>Check your plan</h1>
      <p className="sub">Enter the Order ID from your confirmation together with the email used at checkout.</p>

      <form onSubmit={lookup}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="oid">Order ID</label>
            <input id="oid" required value={orderId} onChange={(e) => setOrderId(e.target.value)} inputMode="numeric" />
          </div>
          <div className="field">
            <label htmlFor="oemail">Email</label>
            <input id="oemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Check status'}
        </button>
      </form>

      {error && (
        <div className="alert error" role="alert">
          <strong>{error.message || 'Lookup failed.'}</strong>
          {error.detail && <pre>{typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail, null, 2)}</pre>}
        </div>
      )}

      {data && (
        <div className="alert ok">
          <strong>Status: {data.status || 'unknown'}</strong>
          <div className="kv" style={{ marginTop: 10 }}>
            {data.product_name && <div><b>Plan</b> {data.product_name}</div>}
            {data.domain && <div><b>Domain</b> {data.domain}</div>}
            {data.period_start && <div><b>Plan started</b> {data.period_start}</div>}
            {data.next_renewal && <div><b>Next renewal</b> {data.next_renewal}</div>}
          </div>
          {data.acme && (
            <>
              <p style={{ marginTop: 10 }}><strong>ACME enrollment credentials</strong> — use these with certbot, acme.sh, Caddy or any ACME client:</p>
              <pre>{JSON.stringify(data.acme, null, 2)}</pre>
            </>
          )}
          {data.autoinstall && data.autoinstall.setup_link && (
            <div style={{ marginTop: 12 }}>
              <p><strong>Set up your automation agent</strong> — open your personal setup portal to connect your server. Issuance and renewals run automatically after that:</p>
              <a className="btn primary" style={{ display: 'inline-block', marginTop: 10 }} href={data.autoinstall.setup_link} target="_blank" rel="noreferrer">
                Open setup portal →
              </a>
              {data.autoinstall.status && (
                <p className="hint" style={{ fontSize: '0.8rem', marginTop: 8 }}>Setup status: {data.autoinstall.status}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
