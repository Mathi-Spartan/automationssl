import React from 'react'
import { Link } from 'react-router-dom'
import { PRODUCTS } from '../catalog.js'

function PlansTable() {
  const regular = PRODUCTS.filter((p) => !p.featured)
  const caas = PRODUCTS.find((p) => p.featured)
  const allProducts = [...regular, caas]
  const brandColor = { RapidSSL: '#1a6bb5', GeoTrust: '#e8832a', Sectigo: '#c00020' }

  const rows = [
    { section: 'Coverage' },
    { label: 'Single domain', vals: [true, true, true, true, true] },
    { label: 'Wildcard (*.domain)', vals: [false, true, false, true, true] },
    { label: 'Multi-domain SANs', vals: [false, false, false, false, '\u2264 255'] },
    { label: 'Add domains anytime', vals: [false, false, false, false, 'pro-rated'] },
    { section: 'Automation' },
    { label: 'AutoInstall agent', vals: [true, true, true, true, false] },
    { label: 'certbot / acme.sh', vals: [true, true, true, true, true] },
    { label: 'Caddy \u00b7 Traefik \u00b7 cert-manager', vals: [true, true, true, true, true] },
    { section: 'Certificate' },
    { label: 'Validation', vals: ['DV', 'DV', 'DV', 'DV', 'DV'] },
    { label: 'OV / EV', vals: [false, false, false, false, false] },
    { label: 'Auto-renews', vals: [true, true, true, true, true] },
    { label: 'Term', vals: ['12 mo', '12 mo', '12 mo', '12 mo', '12 mo'] },
  ]

  function Val({ v }) {
    if (v === true) return <span className="tv-yes"><i className="ti ti-check" aria-hidden="true" /></span>
    if (v === false) return <span className="tv-no"><i className="ti ti-minus" aria-hidden="true" /></span>
    return <span className="tv-partial">{v}</span>
  }

  const shortName = (p) => p.name
    .replace(' Plan + Automate', '').replace(' DV Plan + Automate', '')
    .replace(' DV Wildcard Plan + Automate', '').replace(' Wildcard Plan + Automate', '')
    .replace(' ACME Certificate-as-a-Service', ' CaaS')

  return (
    <div className="tv-outer">
      <table className="tv-table">
        <colgroup>
          <col className="tv-col-label" />
          {allProducts.map((p) => <col key={p.id} className="tv-col-prod" />)}
        </colgroup>
        <thead>
          <tr>
            <th className="tv-corner" />
            {allProducts.map((p) => (
              <th key={p.id} className={"tv-th" + (p.featured ? " tv-th-accent" : "")}>
                <div className="tv-brand-circle" style={{ background: brandColor[p.brand] }}>{p.brand[0]}</div>
                <div className="tv-prod-name">{shortName(p)}</div>
                <div className="tv-prod-sub">{p.coverage}</div>
                {(p.coverage.startsWith("Wildcard") || p.featured) && (
                  <span className={"tv-badge" + (p.featured ? " tv-badge-caas" : " tv-badge-wc")}>
                    {p.featured ? "UP TO 255 SANs" : "WILDCARD"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => row.section ? (
            <tr key={ri} className="tv-section-row"><td colSpan={6}>{row.section}</td></tr>
          ) : (
            <tr key={ri} className="tv-data-row">
              <td className="tv-label">{row.label}</td>
              {row.vals.map((v, ci) => (
                <td key={ci} className={"tv-val" + (allProducts[ci] && allProducts[ci].featured ? " tv-val-accent" : "")}>
                  <Val v={v} />
                </td>
              ))}
            </tr>
          ))}
          <tr className="tv-price-row">
            <td className="tv-label tv-price-label">Price / year</td>
            {allProducts.map((p) => (
              <td key={p.id} className={"tv-val tv-price-cell" + (p.featured ? " tv-val-accent" : "")}>
                <span className="tv-price">{p.price}</span>
                <span className="tv-price-note">{p.priceNote}</span>
              </td>
            ))}
          </tr>
          <tr className="tv-cta-row">
            <td className="tv-label" />
            {allProducts.map((p) => (
              <td key={p.id} className={"tv-val tv-cta-cell" + (p.featured ? " tv-val-accent" : "")}>
                <Link className="tv-btn-order btn primary" to={`/order/${p.slug}`}>Order now</Link>
                <Link className="tv-btn-det" to={`/plan/${p.slug}`}>Details</Link>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function HowItWorksFlow() {
  const [active, setActive] = React.useState('agent')

  const steps = {
    agent: [
      { icon: '🛒', tag: 'Order', title: 'Place your order', desc: 'Sign in, pick a RapidSSL or GeoTrust plan. The CA registers your subscription within minutes.' },
      { icon: '🔗', tag: 'Setup portal', title: 'Open your AutoInstall portal', desc: 'Your dashboard shows a personal SSO link to autoinstallssl.app — click it once.' },
      { icon: '⚡', tag: 'One command', title: 'Run the install script', desc: 'Copy the one-liner from the portal, paste it into your server. The agent installs and phones home.' },
      { icon: '🔄', tag: 'Automated', title: 'Renewals happen on their own', desc: 'The agent validates, issues and renews every cycle. Your dashboard shows live CA status.' },
    ],
    acme: [
      { icon: '🛒', tag: 'Order', title: 'Place your order', desc: 'Sign in, pick the Sectigo CaaS plan. Add as many domains as you need — billed pro-rated by the CA.' },
      { icon: '🔑', tag: 'Credentials', title: 'Grab your EAB credentials', desc: 'Your dashboard hands you three values: ACME server URL, EAB Key ID, and HMAC key. Copy them.' },
      { icon: '💻', tag: 'One command', title: 'Register with certbot or acme.sh', desc: 'Run certbot register with your EAB credentials. Works with Caddy, Traefik, and cert-manager too.' },
      { icon: "🔄", tag: "Automated", title: "Your ACME client handles renewals", desc: "Certbot runs renewal automatically every 60 days. No manual work, ever." },
    ],
  }

  const current = steps[active]

  return (
    <div className="flow-wrap">
      {/* tab switcher */}
      <div className="flow-tabs">
        <button type="button" className={'flow-tab' + (active === 'agent' ? ' on' : '')} onClick={() => setActive('agent')}>
          <span className="flow-tab-icon">⚡</span>
          <span>
            <strong>AutoInstall Agent</strong>
            <em>RapidSSL · GeoTrust</em>
          </span>
        </button>
        <div className="flow-tab-or">or</div>
        <button type="button" className={'flow-tab' + (active === 'acme' ? ' on' : '')} onClick={() => setActive('acme')}>
          <span className="flow-tab-icon">🔑</span>
          <span>
            <strong>ACME / certbot</strong>
            <em>Sectigo CaaS · any ACME client</em>
          </span>
        </button>
      </div>

      {/* animated steps */}
      <div className="flow-steps" key={active}>
        {current.map((s, i) => (
          <React.Fragment key={i}>
            <div className="flow-step" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="flow-step-icon">{s.icon}</div>
              <div className="flow-step-tag">{s.tag}</div>
              <div className="flow-step-title">{s.title}</div>
              <div className="flow-step-desc">{s.desc}</div>
            </div>
            {i < current.length - 1 && <div className="flow-arrow" style={{ animationDelay: `${i * 80 + 60}ms` }}>→</div>}
          </React.Fragment>
        ))}
      </div>

      {/* live terminal — changes per tab */}
      <div className="flow-terminal-wrap" key={active + '-term'}>
        {active === 'acme' ? (
          <div className="terminal flow-terminal" role="img" aria-label="ACME enrollment commands">
            <div><span className="comment"># one-time enrollment with your EAB credentials</span></div>
            <div><span className="prompt">$</span> certbot register <span className="flag">--server</span> https://acme.sectigo.com/v2/DV <span className="flag">--eab-kid</span> &lt;key-id&gt; <span className="flag">--eab-hmac-key</span> &lt;hmac&gt;</div>
            <div><span className="prompt">$</span> certbot certonly <span className="flag">-d</span> example.com</div>
            <div><span className="comment"># renewal is automatic — certbot cron handles it every 60 days</span></div>
          </div>
        ) : (
          <div className="terminal flow-terminal" role="img" aria-label="AutoInstall agent setup">
            <div><span className="comment"># from your dashboard → copy the one-line install command</span></div>
            <div><span className="prompt">$</span> curl <span className="flag">-sL</span> https://autoinstallssl.app/install/&lt;your-token&gt; <span className="flag">|</span> bash</div>
            <div><span className="comment"># agent installs, contacts the CA, issues your cert</span></div>
            <div><span className="prompt">$</span> autoinstall-ssl <span className="flag">--status</span></div>
            <div><span className="prompt output">✓</span> Certificate valid · renews automatically in 298 days</div>
          </div>
        )}
      </div>

      <div className="flow-footer">
        <span className="flow-footer-dot ok" /> Certificate auto-renews every cycle &nbsp;·&nbsp;
        <span className="flow-footer-dot ok" /> Dashboard shows live CA status &nbsp;·&nbsp;
        <span className="flow-footer-dot ok" /> No manual work after setup
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <>
      {/* ---------- blue hero, EasySecurity family style ---------- */}
      <section className="hero">
        <div className="wrap hero-inner">
          <p className="hero-kicker">SSL Automation Store · an easysecurity.in product</p>
          <h1 className="hero-title">
            Order once.
            <br />
            <span className="accent">Secured forever.</span>
          </h1>
          <p className="lede">
            Automation plans from RapidSSL, GeoTrust and Sectigo. Enroll a server
            once — issuance, installation and every renewal after that run
            hands-off. No cron jobs. No 3 a.m. expiry pages.
          </p>
          <div className="hero-actions">
            <a className="btn hero-primary" href="#plans">Browse plans →</a>
            <a className="btn hero-ghost" href="#why">Why automate now</a>
          </div>
          <hr className="hero-rule" />
          <div className="trust-row">
            <span>✓ <b>RapidSSL · GeoTrust · Sectigo</b> trust chain</span>
            <span>✓ <b>Zero-touch</b> issue → install → renew</span>
            <span>✓ <b>47-day lifetimes</b> ready</span>
          </div>
        </div>
      </section>

      {/* ---------- why now: 47-day narrative ---------- */}
      <section className="block" id="why">
        <div className="wrap">
          <div className="section-head center">
            <h2>Manual SSL is about to become impossible.</h2>
            <p>
              The CA/B Forum is cutting public certificate lifetimes to 47 days by 2029.
              What used to be a yearly chore becomes a task every six weeks — per certificate,
              per server. Automation stops being nice-to-have.
            </p>
          </div>
          <div className="value-grid">
            <div className="value-card">
              <span className="value-num">200</span>
              <h3>days today → 47 by 2029</h3>
              <p>Certificate lifetimes are shrinking on a published schedule. Every cut multiplies the renewals you'd do by hand.</p>
            </div>
            <div className="value-card">
              <span className="value-num">1</span>
              <h3>command to automate</h3>
              <p>Install the agent or point your ACME client once. Validation, issuance, installation and renewal run on their own after that.</p>
            </div>
            <div className="value-card">
              <span className="value-num">0</span>
              <h3>expiry incidents</h3>
              <p>Built-in monitoring watches every renewal. If anything needs attention, you hear about it before your visitors ever could.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- plans ---------- */}
      <section className="block alt" id="plans">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Plans</span>
            <h2>Five automation plans. One outcome: always valid.</h2>
            <p>Pick the CA brand and coverage that fits your stack. Every plan includes full lifecycle automation.</p>
          </div>
          <PlansTable />
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="block" id="how">
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">How it works</span>
            <h2>Order once. Your server handles the rest.</h2>
            <p>One order unlocks two paths — pick the one that fits your stack. Both end the same way: your certificate renews itself, forever.</p>
          </div>

          <HowItWorksFlow />
        </div>
      </section>

      {/* ---------- closing CTA band ---------- */}
      <section className="cta-band">
        <div className="wrap">
          <h2>Put your certificates on autopilot today.</h2>
          <p>Every plan is free of charge during the launch testing phase.</p>
          <a className="btn hero-primary" href="#plans">Choose your plan →</a>
        </div>
      </section>
    </>
  )
}
