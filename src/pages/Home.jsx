import { Link } from 'react-router-dom'
import { PRODUCTS } from '../catalog.js'
import { RenewalLoop } from '../App.jsx'

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
      <section className="hero">
        <div className="wrap">
          <div>
            <span className="eyebrow">RapidSSL · GeoTrust · Sectigo ACME</span>
            <h1>
              Certificates that <span className="loopword">renew themselves</span>.
            </h1>
            <p className="lede">
              Automation plans from three major Certificate Authorities. Enroll a
              server once — issuance, deployment checks and every renewal after
              that run without you. No cron jobs. No 3 a.m. expiry pages.
            </p>
            <div className="hero-actions">
              <a className="btn primary" href="#plans">Browse plans</a>
              <a className="btn ghost" href="#how">How it works</a>
            </div>
            <p className="testing-note">
              <span className="dot" /> Launch testing phase — every plan is free of charge
            </p>
          </div>
          <RenewalLoop />
        </div>
      </section>

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
                Choose a plan and tell us the domain and contact details. Your
                plan is registered with the Certificate Authority within minutes.
              </p>
            </div>
            <div className="step">
              <span className="mono-tag">02 / enroll</span>
              <h3>Point your ACME client at the CA</h3>
              <p>
                You receive enrollment credentials for your plan. Certbot,
                acme.sh, Caddy, Traefik or cert-manager — any standard ACME
                client works.
              </p>
            </div>
            <div className="step">
              <span className="mono-tag">03 / forget</span>
              <h3>Renewals happen on their own</h3>
              <p>
                Your server and the CA handle validation, issuance and renewal
                between themselves for the full plan term. Check the order status
                page any time.
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
    </>
  )
}
