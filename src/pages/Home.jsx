import React from 'react'
import { Link } from 'react-router-dom'
import { PRODUCTS } from '../catalog.js'

function PlanCard({ p }) {
  const isWild = p.coverage.startsWith('Wildcard')
  const isFeatured = p.featured

  if (isFeatured) {
    return (
      <article className="pcard pcard-featured">
        <div className="pcard-featured-left">
          <div className="pcard-brand-row">
            <span className="pcard-brand-badge sectigo">Sectigo</span>
            <span className="pcard-brand-badge dv">DV</span>
            <span className="pcard-brand-badge san">Up to 255 SANs</span>
          </div>
          <h3 className="pcard-name">{p.name}</h3>
          <p className="pcard-tagline">{p.tagline}</p>
          <p className="pcard-meta">{p.coverage} · {p.periods.map((m) => `${m}mo`).join(' / ')} plans</p>
          <div className="pcard-acme-preview">
            <span className="pcard-acme-label">Works with any ACME client</span>
            <div className="pcard-acme-logos">
              {['certbot', 'acme.sh', 'Caddy', 'Traefik', 'cert-manager'].map((c) => (
                <span key={c} className="pcard-acme-chip">{c}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="pcard-featured-right">
          <div className="pcard-price-block">
            <span className="pcard-price">$0</span>
            <span className="pcard-price-note">free during launch testing</span>
          </div>
          <Link className="btn primary pcard-order-btn" to={`/order/${p.slug}`}>Order free &rarr;</Link>
          <Link className="pcard-details-link" to={`/plan/${p.slug}`}>View plan details</Link>
          <p className="pcard-san-note">Add domains any time &middot; billed pro-rated by the CA</p>
        </div>
      </article>
    )
  }

  const brandBg = p.brand === 'RapidSSL' ? '#1a3a5c' : '#163d22'
  const brandAccent = p.brand === 'RapidSSL' ? '#7ab8e8' : '#6dc98a'
  const icon = isWild ? '✳' : '🔒'
  const feature = isWild
    ? ['Covers all subdomains (*.domain)', 'One cert, unlimited sub-sites', 'AutoInstall agent or ACME']
    : ['Single domain, always valid', 'Zero manual renewal steps', 'AutoInstall agent or ACME']

  return (
    <article className={"pcard pcard-split" + (isWild ? " pcard-wild" : "")}>
      <div className="pcard-split-left" style={{ background: brandBg }}>
        <div className="pcard-brand-row">
          <span className={"pcard-brand-badge " + p.brand.toLowerCase()}>{p.brand}</span>
          <span className="pcard-brand-badge dv">{p.validation}</span>
          {isWild && <span className="pcard-brand-badge wild">Wildcard</span>}
        </div>
        <div className="pcard-split-icon" style={{ color: brandAccent }}>{icon}</div>
        <h3 className="pcard-name">{p.name}</h3>
        <p className="pcard-tagline" style={{ color: '#9bbdd4' }}>{p.tagline}</p>
        <ul className="pcard-features">
          {feature.map((f) => (
            <li key={f} style={{ color: brandAccent }}>
              <span style={{ marginRight: 7 }}>✓</span>
              <span style={{ color: '#c8dce8' }}>{f}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="pcard-split-right">
        <div className="pcard-price-block">
          <span className="pcard-price">$0</span>
          <span className="pcard-price-note">free during launch testing</span>
        </div>
        <p className="pcard-meta" style={{ marginBottom: 16 }}>{p.coverage} · {p.periods.map((m) => `${m}mo`).join(' / ')} plans</p>
        <Link className="btn primary pcard-order-btn" to={`/order/${p.slug}`}>Order free →</Link>
        <Link className="pcard-details-link" to={`/plan/${p.slug}`}>View plan details</Link>
      </div>
    </article>
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
            <p>
              Pick the CA brand and coverage you need. Every plan includes
              lifecycle automation for its full term.
            </p>
          </div>
          <div className="pcard-brand-group">
            <div className="pcard-brand-label">
              <span className="pcard-brand-eyebrow">⚡ AutoInstall Agent</span>
              <span className="pcard-brand-sub">RapidSSL &middot; GeoTrust &mdash; agent or ACME supported</span>
            </div>
            <div className="pcard-grid-2">
              {PRODUCTS.filter((p) => !p.featured).map((p) => <PlanCard key={p.id} p={p} />)}
            </div>
          </div>
          <div className="pcard-brand-group">
            <div className="pcard-brand-label">
              <span className="pcard-brand-eyebrow">🔑 ACME / certbot</span>
              <span className="pcard-brand-sub">Sectigo CaaS &mdash; any ACME client</span>
            </div>
            {PRODUCTS.filter((p) => p.featured).map((p) => <PlanCard key={p.id} p={p} />)}
          </div>

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
