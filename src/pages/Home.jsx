import React from 'react'
import { Link } from 'react-router-dom'
import { PRODUCTS } from '../catalog.js'

function PlansTable() {
  const regular = PRODUCTS.filter((p) => !p.featured)
  const caas = PRODUCTS.find((p) => p.featured)
  const allProducts = [...regular, caas]

  const meta = {
    400: { color: '#1a6bb5', features: ['Single domain (www + apex)', 'AutoInstall agent', 'All ACME clients', 'Auto-renews · 12 mo', 'DV — issued in minutes'] },
    401: { color: '#1a6bb5', features: ['All subdomains (*.domain)', 'AutoInstall agent', 'All ACME clients', 'Auto-renews · 12 mo', 'DV — issued in minutes'] },
    402: { color: '#c26a00', features: ['Single domain (www + apex)', 'AutoInstall agent', 'All ACME clients', 'Auto-renews · 12 mo', 'DV — GeoTrust brand'] },
    403: { color: '#c26a00', features: ['All subdomains (*.domain)', 'AutoInstall agent', 'All ACME clients', 'Auto-renews · 12 mo', 'DV — GeoTrust brand'] },
    300: { color: '#b8001a', features: ['Up to 255 SANs + wildcards', 'Add domains anytime', 'All ACME clients (no agent)', 'Auto-renews · 12 mo', 'DV — Sectigo CA'] },
  }

  const missing = {
    400: ['Wildcard', 'Multi-domain SANs'],
    401: ['Multi-domain SANs'],
    402: ['Wildcard', 'Multi-domain SANs'],
    403: ['Multi-domain SANs'],
    300: ['AutoInstall agent'],
  }

  const shortName = (p) => p.name
    .replace(' Plan + Automate', '').replace(' DV Plan + Automate', '')
    .replace(' DV Wildcard Plan + Automate', '').replace(' Wildcard Plan + Automate', '')
    .replace(' ACME Certificate-as-a-Service', ' CaaS')

  return (
    <div className="pc3-grid">
      {allProducts.map((p) => {
        const m = meta[p.id]
        const isAccent = p.featured
        return (
          <article key={p.id} className={'pc3-card' + (isAccent ? ' pc3-card-accent' : '')}>
            <div className="pc3-head">
              <div className="pc3-logo" style={{ background: m.color }}>
                {p.brand === 'RapidSSL' && (
                  <svg viewBox="0 0 28 28" width="28" height="28"><text x="14" y="11" textAnchor="middle" fill="#fff" fontSize="5.5" fontWeight="800" fontFamily="Arial,sans-serif">RAPID</text><text x="14" y="19" textAnchor="middle" fill="#90d0f8" fontSize="7" fontWeight="800" fontFamily="Arial,sans-serif">SSL</text><rect x="5" y="21" width="18" height="1.5" rx="0.75" fill="#90d0f8" opacity="0.5"/></svg>
                )}
                {p.brand === 'GeoTrust' && (
                  <svg viewBox="0 0 28 28" width="28" height="28"><circle cx="14" cy="13" r="7" fill="none" stroke="#ffa040" strokeWidth="1.8"/><ellipse cx="14" cy="13" rx="3.5" ry="7" fill="none" stroke="#ffa040" strokeWidth="1.2"/><line x1="7" y1="13" x2="21" y2="13" stroke="#ffa040" strokeWidth="1.2"/><text x="14" y="25" textAnchor="middle" fill="#ffa040" fontSize="4.5" fontWeight="700" fontFamily="Arial,sans-serif">GeoTrust</text></svg>
                )}
                {p.brand === 'Sectigo' && (
                  <svg viewBox="0 0 28 28" width="28" height="28"><path d="M14 4 L22 7.5 L22 15 Q22 21 14 24.5 Q6 21 6 15 L6 7.5 Z" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5"/><text x="14" y="17" textAnchor="middle" fill="#fff" fontSize="5.5" fontWeight="800" fontFamily="Arial,sans-serif">Sectigo</text></svg>
                )}
              </div>
              <div className="pc3-head-text">
                <div className="pc3-brand">{p.brand}</div>
                <h3 className="pc3-name">{shortName(p)}</h3>
              </div>
              {isAccent && <span className="pc3-popular">Most flexible</span>}
            </div>

            <div className="pc3-coverage">
              <span className="pc3-cov-label">Coverage</span>
              <span className="pc3-cov-val">{p.coverage}</span>
            </div>

            <ul className="pc3-features">
              {m.features.map((f) => (
                <li key={f} className="pc3-feat-yes">
                  <i className="ti ti-check" aria-hidden="true" />
                  {f}
                </li>
              ))}
              {missing[p.id].map((f) => (
                <li key={f} className="pc3-feat-no">
                  <i className="ti ti-minus" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>

            <div className="pc3-foot">
              <div className="pc3-price-block">
                <span className="pc3-price">{p.price}</span>
                <span className="pc3-price-note">{p.priceNote}</span>
              </div>
              <Link className={'pc3-btn-order' + (isAccent ? ' pc3-btn-accent' : '')} to={`/order/${p.slug}`}>Order now</Link>
              <Link className="pc3-btn-det" to={`/plan/${p.slug}`}>View details</Link>
            </div>
          </article>
        )
      })}
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
