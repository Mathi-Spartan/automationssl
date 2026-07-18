import React, { useEffect, useState } from 'react'
import { useParams, Navigate, Link, useLocation } from 'react-router-dom'
import { bySlug } from '../catalog.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'


function WizardCopyBtn({ text }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <button type="button" className="wizard-copy-btn" onClick={async () => {
      try { await navigator.clipboard.writeText(text) } catch {}
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    }}>{copied ? 'Copied ✓' : 'Copy'}</button>
  )
}

function WizardCred({ label, value }) {
  return (
    <div className="wizard-cred-row">
      <span className="wizard-cred-label">{label}</span>
      <div className="wizard-cred-val-wrap">
        <code className="wizard-cred-val">{value}</code>
        <WizardCopyBtn text={value} />
      </div>
    </div>
  )
}

export default function Order() {
  const { slug } = useParams()
  const p = bySlug(slug)
  const { session, profile, loading } = useAuth()
  const location = useLocation()
  const [form, setForm] = useState({
    domain: '',
    email: '',
    firstname: '',
    lastname: '',
    phone: '',
    period: p ? p.periods[0] : 12,
    server_id: '',
    agree: false,
  })
  const [servers, setServers] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // Prefill from the signed-in account
  useEffect(() => {
    if (!session?.user) return
    setForm((f) => {
      const parts = (profile?.full_name || '').trim().split(/\s+/)
      return {
        ...f,
        email: f.email || session.user.email || '',
        firstname: f.firstname || parts[0] || '',
        lastname: f.lastname || parts.slice(1).join(' ') || '',
      }
    })
    supabase
      ?.from('servers')
      .select('id, name, environment')
      .eq('owner_id', session.user.id)
      .order('name')
      .then(({ data }) => setServers(data || []))
  }, [session?.user?.id, profile?.full_name])

  if (!p) return <Navigate to="/" replace />
  if (loading) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />

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
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess?.session?.access_token || ''}`,
        },
        body: JSON.stringify({
          product_id: p.id,
          period: Number(form.period),
          domain: form.domain.trim(),
          email: form.email.trim(),
          firstname: form.firstname.trim(),
          lastname: form.lastname.trim(),
          phone: form.phone.trim(),
          server_id: form.server_id || null,
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
    const isAcme = !!result.acme
    const steps = isAcme
      ? ['Order confirmed', 'Configure ACME client', 'Renews automatically']
      : ['Order confirmed', 'Install the agent', 'Renews automatically']

    return (
      <div className="wizard-wrap">
        {/* progress bar */}
        <div className="wizard-progress">
          {steps.map((s, i) => (
            <div key={i} className={"wizard-step" + (i === 0 ? " done" : i === 1 ? " active" : "")}>
              <div className="wizard-step-dot">{i === 0 ? "✓" : i + 1}</div>
              <div className="wizard-step-label">{s}</div>
              {i < steps.length - 1 && <div className="wizard-step-line" />}
            </div>
          ))}
        </div>

        {/* Step 1 — confirmation */}
        <div className="wizard-card wizard-card-done">
          <div className="wizard-card-head">
            <span className="wizard-check">✓</span>
            <div>
              <div className="wizard-card-title">Order confirmed</div>
              <div className="wizard-card-sub">Your certificate plan is registered with the CA.</div>
            </div>
          </div>
          <div className="wizard-meta-grid">
            <div><span className="wizard-meta-label">Order ID</span><span className="wizard-meta-val mono">{result.order_id}</span></div>
            <div><span className="wizard-meta-label">Plan</span><span className="wizard-meta-val">{p.name}</span></div>
            <div><span className="wizard-meta-label">Domain</span><span className="wizard-meta-val">{form.domain || '—'}</span></div>
            <div><span className="wizard-meta-label">Contact</span><span className="wizard-meta-val">{form.email}</span></div>
          </div>
        </div>

        {/* Step 2 — setup */}
        <div className="wizard-card wizard-card-active">
          <div className="wizard-card-head">
            <span className="wizard-num">2</span>
            <div>
              <div className="wizard-card-title">{isAcme ? 'Configure your ACME client' : 'Install the automation agent'}</div>
              <div className="wizard-card-sub">{isAcme ? 'One command — then your server handles everything.' : 'Open your setup portal and run one command on your server.'}</div>
            </div>
          </div>

          {isAcme && result.acme ? (
            <div className="wizard-setup-body">
              <div className="wizard-cred-grid">
                <WizardCred label="ACME server URL" value={result.acme.server_url} />
                <WizardCred label="EAB key ID" value={result.acme.eab_kid} />
                <WizardCred label="EAB HMAC key" value={result.acme.eab_hmac_key} />
              </div>
              <div className="wizard-cmd-block">
                <div className="wizard-cmd-label">Quick start — copy and run</div>
                <div className="wizard-cmd-wrap">
                  <code className="wizard-cmd">{`certbot register --server ${result.acme.server_url} --eab-kid ${result.acme.eab_kid} --eab-hmac-key ${result.acme.eab_hmac_key}`}</code>
                  <WizardCopyBtn text={`certbot register --server ${result.acme.server_url} --eab-kid ${result.acme.eab_kid} --eab-hmac-key ${result.acme.eab_hmac_key}`} />
                </div>
              </div>
              <p className="wizard-hint">Works with certbot, acme.sh, Caddy, Traefik, and cert-manager. Save these credentials — they are yours alone.</p>
            </div>
          ) : result.autoinstall && result.autoinstall.setup_link ? (
            <div className="wizard-setup-body">
              <p className="wizard-setup-desc">Your personal setup portal is ready. Click below — it opens the AutoInstall dashboard where you run one command on your server. Issuance and all future renewals happen automatically from there.</p>
              <a className="wizard-portal-btn" href={result.autoinstall.setup_link} target="_blank" rel="noreferrer">
                <i className="ti ti-external-link" aria-hidden="true" /> Open my setup portal
              </a>
              <p className="wizard-hint">This link is personal to your plan — bookmark it and do not share it.</p>
            </div>
          ) : (
            <div className="wizard-setup-body">
              <p className="wizard-setup-desc">Your setup credentials are being provisioned by the CA — this usually takes under 2 minutes. Open your <Link to="/dashboard">dashboard</Link> to see them as soon as they are ready.</p>
            </div>
          )}
        </div>

        {/* Step 3 — future */}
        <div className="wizard-card wizard-card-future">
          <div className="wizard-card-head">
            <span className="wizard-num wizard-num-future">3</span>
            <div>
              <div className="wizard-card-title">Renewals happen on their own</div>
              <div className="wizard-card-sub">After setup, your server and the CA handle everything. No cron jobs. No manual steps.</div>
            </div>
          </div>
        </div>

        <div className="wizard-footer">
          <Link className="btn primary" to="/dashboard">Go to my dashboard →</Link>
          <Link className="btn ghost" to="/">Back to plans</Link>
        </div>
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

        {servers.length > 0 && (
          <div className="field">
            <label htmlFor="server">Install on server (optional)</label>
            <select id="server" value={form.server_id} onChange={set('server_id')}>
              <option value="">— choose later —</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>
              ))}
            </select>
            <p className="hint">Tags this plan to one of your servers so it shows up in the Servers view.</p>
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
