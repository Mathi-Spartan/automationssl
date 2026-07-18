import { Link } from 'react-router-dom'
import { PRODUCTS } from '../catalog.js'

function PlanCard({ p }) {
  return (
    <article className={`card${p.featured ? ' featured' : ''}`}>
      <div className="row">
        <span className="pill brand">{p.brand}</span>
        <span className="pill">{p.validation}</span>
        {p.coverage.startsWith('Wildcard') && <span className="pill amber">Wildcard</span>}
        {p.featured && <span className="pill amber">Up to 255 SANs</span>}
      </div>
      <h3>{p.name}</h3>
      <p className="tagline">{p.tagline}</p>
      <p className="meta">
        {p.coverage} · {p.periods.map((m) => `${m}mo`).join(' / ')} plans
      </p>
      <div className="foot">
        <div className="price">
          $0
          <small>free during launch testing</small>
        </div>
        <div className="row">
          <Link className="btn ghost" to={`/plan/${p.slug}`}>Details</Link>
          <Link className="btn primary" to={`/order/${p.slug}`}>Order free</Link>
        </div>
      </div>
    </article>
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
          <div className="grid">
            {PRODUCTS.map((p) => (
              <PlanCard key={p.id} p={p} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="block" id="how">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2>Three steps, then never again.</h2>
          </div>
          <div className="steps">
            <div className="step">
              <span className="mono-tag">01 / order</span>
              <h3>Place your free order</h3>
              <p>
                Sign in, choose a plan and tell us your contact details. Your
                subscription is registered with the Certificate Authority within
                minutes and appears in your dashboard.
              </p>
            </div>
            <div className="step">
              <span className="mono-tag">02 / connect</span>
              <h3>Install the agent — or point ACME at the CA</h3>
              <p>
                AutoInstall plans give you a personal setup portal with a one-line
                install command. The Sectigo plan hands you ACME credentials for
                certbot, acme.sh, Caddy, Traefik or cert-manager.
              </p>
            </div>
            <div className="step">
              <span className="mono-tag">03 / forget</span>
              <h3>Renewals happen on their own</h3>
              <p>
                Your server and the CA handle validation, issuance and renewal
                between themselves for the full plan term. Your dashboard shows
                live status the whole way.
              </p>
            </div>
          </div>

          <div style={{ marginTop: 28 }}>
            <div className="terminal" role="img" aria-label="Terminal example showing an ACME client registering with the CA">
              <div><span className="comment"># one-time enrollment — after this, renewals are automatic</span></div>
              <div>
                <span className="prompt">$</span> certbot register <span className="flag">--server</span> https://acme.sectigo.com/v2/DV{' '}
                <span className="flag">--eab-kid</span> &lt;your-key-id&gt; <span className="flag">--eab-hmac-key</span> &lt;your-hmac&gt;
              </div>
              <div>
                <span className="prompt">$</span> certbot certonly <span className="flag">-d</span> example.com <span className="flag">-d</span> '*.example.com'
              </div>
              <div><span className="comment"># done. certificate issued, renewal timer armed.</span></div>
            </div>
          </div>
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
