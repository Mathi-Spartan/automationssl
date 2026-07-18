import React, { useCallback, useEffect, useRef, useState } from 'react'

/* Every value below comes from live orders #3575672 (AIS) and #3575678 (CaaS).
   Tokens and secrets are truncated for public display. */

const FLOWS = {
  agent: {
    label: 'AutoInstall agent',
    accent: '#1a6bb5',
    tint: '#e8f0fa',
    steps: [
      {
        key: 'order', label: 'Order',
        title: 'The order registers a subscription',
        body: 'Your plan is created at the CA and comes back with a personal portal link. Nothing is installed yet — the subscription simply exists and is waiting for a server.',
        portal: {
          head: 'Portal · subscription', badge: 'Order 3575672',
          blocks: [
            { t: 'kv', k: 'Product', v: 'RapidSSL Plan + Automate' },
            { t: 'kv', k: 'Category', v: 'ais' },
            { t: 'kv', k: 'Begins', v: '2026-07-17' },
            { t: 'kv', k: 'Status', v: 'incomplete', tone: 'warn' },
          ],
        },
        api: { head: 'POST /api/order', code: `{
  "order_id": 3575672,
  "item_id": 993,
  "autoinstall": {
    "status": "incomplete",
    "login_sso_link": "https://autoinstallssl.app/login/…"
  }
}` },
      },
      {
        key: 'creds', label: 'Credentials',
        title: 'The portal issues an install token',
        body: 'Opening the SSO link drops you straight into the AutoInstall portal for this subscription. You pick the domain and web server, and it hands back a token scoped to that one subscription.',
        portal: {
          head: 'Portal · on the server', badge: 'autoinstallssl.app',
          blocks: [
            { t: 'field', k: 'Domain', v: 'example.com' },
            { t: 'field', k: 'Server', v: 'NGINX' },
            { t: 'field', k: 'AIS token', v: 'z55U6vS5…j5aeMqy', mark: true },
          ],
        },
        api: { head: 'GET · token status', code: `{
  "AISToken": "z55U6vS5…j5aeMqy",
  "IsAgentInstalled": false
}` },
      },
      {
        key: 'install', label: 'Install',
        title: 'Two commands on the box',
        body: 'The first command installs the agent once per server. The second installs the certificate for this subscription and wires it into the web server. Run them and you are done.',
        portal: {
          head: 'Portal · on the server', badge: 'NGINX',
          blocks: [
            { t: 'step', n: 1, k: 'Install agent once per box', cmd: 'sudo wget -qO - https://files.autoinstallssl.com/packages/linux/version/latest/get.autoinstallssl.sh | sudo bash -s' },
            { t: 'step', n: 2, k: 'Install certificate for this subscription', cmd: 'sudo runautoinstallssl.sh installcertificate --token z55U6vS5…j5aeMqy --validationtype file --validationprovider filesystem' },
          ],
        },
        api: { head: 'GET · token status', code: `{
  "AISToken": "z55U6vS5…j5aeMqy",
  "IsAgentInstalled": true
}` },
      },
      {
        key: 'renew', label: 'Renew',
        title: 'Renewals run without you',
        body: 'The agent stays on the box, revalidates and reinstalls each cycle, and reports back. Your dashboard shows the subscription as automated with the next renewal date.',
        portal: {
          head: 'Portal · subscription', badge: 'Order 3575672',
          blocks: [
            { t: 'kv', k: 'Status', v: 'automated', tone: 'ok' },
            { t: 'kv', k: 'Agent', v: 'installed', tone: 'ok' },
            { t: 'kv', k: 'Next renewal', v: '2027-07-17' },
            { t: 'kv', k: 'Manual steps', v: 'none', tone: 'ok' },
          ],
        },
        api: { head: 'GET /api/refresh', code: `{
  "status": "active",
  "autoinstall": { "status": "completed" },
  "subscription": { "next_renewal": "2027-07-17" }
}` },
      },
    ],
  },

  acme: {
    label: 'ACME / certbot',
    accent: '#b8001a',
    tint: '#fdeaea',
    steps: [
      {
        key: 'order', label: 'Order',
        title: 'The order opens a CaaS subscription',
        body: 'A Certificate-as-a-Service plan is created at Sectigo. It covers up to 255 names, and you add or remove domains against it whenever you like.',
        portal: {
          head: 'Portal · subscription', badge: 'Order 3575678',
          blocks: [
            { t: 'kv', k: 'Product', v: 'Sectigo ACME CaaS' },
            { t: 'kv', k: 'Category', v: 'caas' },
            { t: 'kv', k: 'First domain', v: 'freecerts.in.net' },
            { t: 'kv', k: 'Account', v: 'pending', tone: 'warn' },
          ],
        },
        api: { head: 'POST /api/order', code: `{
  "order_id": 3575678,
  "item_id": 994,
  "acme": {
    "server_url": "https://acme.sectigo.com/v2/DV",
    "eab_mac_id": "jGCgV8Wh…",
    "eab_mac_key": "••••••••"
  }
}` },
      },
      {
        key: 'creds', label: 'Credentials',
        title: 'The subscription provides its ACME credentials',
        body: 'Directory URL, key ID and HMAC key come back with the order and are shown in your dashboard. Any ACME client accepts these three values — certbot, acme.sh, Caddy, Traefik or cert-manager.',
        portal: {
          head: 'Portal · ACME credentials', badge: 'Subscription 994',
          blocks: [
            { t: 'field', k: 'Directory URL', v: 'https://acme.sectigo.com/v2/DV' },
            { t: 'field', k: 'Key ID', v: 'jGCgV8Wh…', mark: true },
            { t: 'field', k: 'HMAC key', v: '••••••••••••••••', mark: true },
          ],
        },
        api: { head: 'GET · EAB credentials', code: `{
  "server_url": "https://acme.sectigo.com/v2/DV",
  "eab_mac_id": "jGCgV8Wh…",
  "eab_mac_key": "••••••••"
}` },
      },
      {
        key: 'issue', label: 'Issue',
        title: 'Register once, then request',
        body: 'Bind your ACME client to the account with the EAB credentials, then ask for the certificate. The config directory flag keeps everything under a path you choose.',
        portal: {
          head: 'Portal · on the server', badge: 'certbot',
          blocks: [
            { t: 'step', n: 1, k: 'Bind the ACME account', cmd: 'certbot register --server https://acme.sectigo.com/v2/DV --config-dir /etc/ssl/acme --eab-kid jGCgV8Wh… --eab-hmac-key ••••••••' },
            { t: 'step', n: 2, k: 'Request the certificate', cmd: 'certbot certonly --config-dir /etc/ssl/acme -d freecerts.in.net' },
          ],
        },
        api: { head: 'GET · account status', code: `{
  "account": { "status": "active" },
  "certificate": "/etc/ssl/acme/live/freecerts.in.net/"
}` },
      },
      {
        key: 'grow', label: 'Grow',
        title: 'Add domains against the same plan',
        body: 'One subscription covers up to 255 names. New domains are added from your dashboard or the API and are billed pro-rated by the CA — no second order to place.',
        portal: {
          head: 'Portal · domains', badge: 'Subscription 994',
          blocks: [
            { t: 'kv', k: 'Domains in use', v: '1 of 255' },
            { t: 'kv', k: 'Wildcards', v: 'supported', tone: 'ok' },
            { t: 'kv', k: 'Renewals', v: 'automatic', tone: 'ok' },
            { t: 'kv', k: 'Next renewal', v: '2027-07-18' },
          ],
        },
        api: { head: 'POST /api/domains', code: `{
  "subscription": 994,
  "add": ["shop.freecerts.in.net"],
  "billing": "pro-rated"
}` },
      },
    ],
  },
}

const TABS = [
  { key: 'agent', label: 'AutoInstall agent' },
  { key: 'acme', label: 'ACME / certbot' },
]

function PortalBlock({ b }) {
  if (b.t === 'kv') {
    return (
      <div className="fl-kv">
        <span className="fl-kv-k">{b.k}</span>
        <span className={'fl-kv-v' + (b.tone ? ' fl-' + b.tone : '')}>{b.v}</span>
      </div>
    )
  }
  if (b.t === 'field') {
    return (
      <div className="fl-field">
        <span className="fl-field-k">{b.k}</span>
        <span className={'fl-field-v' + (b.mark ? ' fl-mark' : '')}>{b.v}</span>
      </div>
    )
  }
  return (
    <div className="fl-step">
      <div className="fl-step-head">
        <span className="fl-step-n">{b.n}</span>
        <span className="fl-step-k">{b.k}</span>
      </div>
      <code className="fl-cmd">{b.cmd}</code>
    </div>
  )
}

export default function AutomationTheatre() {
  const [flow, setFlow] = useState('agent')
  const [idx, setIdx] = useState(0)
  const [auto, setAuto] = useState(false)
  const rootRef = useRef(null)
  const started = useRef(false)
  const timer = useRef(null)

  const f = FLOWS[flow]
  const step = f.steps[idx]

  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }

  const run = useCallback(() => {
    stop()
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    setAuto(true)
    timer.current = setInterval(() => {
      setIdx((i) => {
        if (i >= 3) { stop(); setAuto(false); return i }
        return i + 1
      })
    }, 4200)
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && !started.current) { started.current = true; run(); io.unobserve(e.target) }
      })
    }, { threshold: 0.3 })
    io.observe(el)
    return () => { io.disconnect(); stop() }
  }, [run])

  useEffect(() => () => stop(), [])

  const pick = (i) => { stop(); setAuto(false); setIdx(i) }
  const switchFlow = (key) => {
    if (key === flow) return
    stop(); setAuto(false); setFlow(key); setIdx(0)
  }

  return (
    <div className="fl" ref={rootRef} style={{ '--accent': f.accent, '--tint': f.tint }}>
      <div className="fl-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={flow === t.key}
            className={'fl-tab' + (flow === t.key ? ' on' : '')}
            onClick={() => switchFlow(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="fl-panel">
        <div className="fl-stepper" role="tablist">
          {f.steps.map((s, i) => (
            <button key={s.key} role="tab" aria-selected={i === idx}
              className={'fl-sp' + (i === idx ? ' on' : '') + (i < idx ? ' done' : '')}
              onClick={() => pick(i)}>
              <span className="fl-sp-dot" />
              <span className="fl-sp-label">{s.label}</span>
            </button>
          ))}
          <span className={'fl-sp-track' + (auto ? ' run' : '')} aria-hidden="true">
            <span className="fl-sp-fill" style={{ width: ((idx + 1) / f.steps.length) * 100 + '%' }} />
          </span>
        </div>

        <div className="fl-body" key={flow + idx}>
          <div className="fl-explain">
            <h3 className="fl-title">{step.title}</h3>
            <p className="fl-text">{step.body}</p>
          </div>

          <div className="fl-col">
            <div className="fl-col-label">Portal</div>
            <div className="fl-card">
              <div className="fl-card-head">
                <span className="fl-card-title">{step.portal.head}</span>
                <span className="fl-card-badge">{step.portal.badge}</span>
              </div>
              <div className="fl-card-body">
                {step.portal.blocks.map((b, i) => <PortalBlock b={b} key={i} />)}
              </div>
            </div>
          </div>

          <div className="fl-col">
            <div className="fl-col-label">API</div>
            <div className="fl-card">
              <div className="fl-card-head">
                <span className="fl-card-title fl-mono">{step.api.head}</span>
              </div>
              <div className="fl-card-body">
                <pre className="fl-code">{step.api.code}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
