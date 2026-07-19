import React from 'react'
import { Link } from 'react-router-dom'
import { PRODUCTS } from '../catalog.js'
import { Reveal, Stagger, LineReveal, CountUp } from '../components/Motion.jsx'
import AutomationTheatre from '../components/AutomationTheatre.jsx'

const META = {
  400: { color: '#1a6bb5', tint: '#e8f0fa', tag: 'Agent + ACME', coverage: 'Single domain', pick: 'Expert pick', pickNote: 'Both setup methods', features: ['www + apex domain', 'AutoInstall agent — any server', 'Or any ACME client', 'Auto-renews every cycle'] },
  401: { color: '#1a6bb5', tint: '#e8f0fa', tag: 'Agent + ACME', coverage: 'Wildcard', pick: 'Linux admin favourite', pickNote: 'Both setup methods', features: ['All *.domain subdomains', 'AutoInstall agent — any server', 'Or any ACME client', 'Auto-renews every cycle'] },
  402: { color: '#c26a00', tint: '#fff2e2', tag: 'Agent + ACME', coverage: 'Single domain', pick: 'Top pick', pickNote: 'Both setup methods', features: ['www + apex domain', 'AutoInstall agent — any server', 'Or any ACME client', 'GeoTrust trust chain'] },
  403: { color: '#c26a00', tint: '#fff2e2', tag: 'Agent + ACME', coverage: 'Wildcard', pick: 'Best for teams', pickNote: 'Both setup methods', features: ['All *.domain subdomains', 'AutoInstall agent — any server', 'Or any ACME client', 'GeoTrust trust chain'] },
  300: { color: '#b8001a', tint: '#fdeaea', tag: 'ACME only', coverage: 'Multi-domain', features: ['Up to 255 SANs + wildcards', 'Add domains anytime', 'Needs an ACME client', 'Auto-renews every cycle'] },
}

const shortPer = (note) => (note || '').split('·')[0].trim()

function BrandMark({ brand, color }) {
  if (brand === 'GeoTrust') return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke={color} strokeWidth="1.6" />
      <ellipse cx="12" cy="12" rx="4" ry="8.5" fill="none" stroke={color} strokeWidth="1.3" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" stroke={color} strokeWidth="1.3" />
    </svg>
  )
  if (brand === 'Sectigo') return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M12 2.5 L20 6 v6.5 c0 5-3.6 7.8-8 9.2-4.4-1.4-8-4.2-8-9.2V6z" fill="none" stroke={color} strokeWidth="1.6" />
      <circle cx="12" cy="11.2" r="2.5" fill="none" stroke={color} strokeWidth="1.6" />
      <path d="M12 13.7v3.6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M12 2.5 L20 6 v6.5 c0 5-3.6 7.8-8 9.2-4.4-1.4-8-4.2-8-9.2V6z" fill="none" stroke={color} strokeWidth="1.6" />
      <path d="M8.4 12.1l2.5 2.5 4.7-4.9" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlanCards() {
  const ordered = [...PRODUCTS.filter((p) => !p.featured), PRODUCTS.find((p) => p.featured)].filter(Boolean)
  return (
    <Stagger className="pb-grid" step={80}>
      {ordered.map((p) => {
        const m = META[p.id] || META[400]
        return (
          <article className={'pb-card' + (p.featured ? ' pb-card-hi' : '') + (m.pick ? ' pb-card-pick' : '')} key={p.id} style={{ '--ca': m.color }}>
            <div className="pb-card-top">
              <span className="pb-mark" style={{ background: m.tint }}>
                <BrandMark brand={p.brand} color={m.color} />
              </span>
              <span className="pb-tag" style={{ background: m.tint, color: m.color }}>{m.tag}</span>
            </div>
            {p.featured && <span className="pb-ribbon">Most domains</span>}
            {m.pick && <span className="pb-pick">{m.pick}</span>}
            <h3 className="pb-name">{p.name.replace(' Plan + Automate', '').replace(' ACME Certificate-as-a-Service', ' ACME CaaS')}</h3>
            <p className="pb-coverage">{m.coverage} · DV certificate</p>
            <p className={'pb-dual' + (m.pickNote ? '' : ' pb-dual-solo')}>
              <i className={'ti ' + (m.pickNote ? 'ti-arrows-shuffle' : 'ti-terminal-2')} aria-hidden="true" />
              {m.pickNote ? <>Agent <span>or</span> ACME</> : <>ACME <span>only</span></>}
            </p>
            <div className="pb-price">{p.price}<span className="pb-per">{shortPer(p.priceNote)}</span></div>
            <ul className="pb-features">
              {m.features.map((f) => (
                <li key={f}><i className="ti ti-check" aria-hidden="true" />{f}</li>
              ))}
            </ul>
            <Link className="pb-cta" to={`/order/${p.slug}`}>
              Order now <i className="b-arrow" aria-hidden="true">→</i>
            </Link>
          </article>
        )
      })}
    </Stagger>
  )
}

/* Rotates a highlight through the CA names in the trust row.
   Pauses on hover so the existing hover state still wins. */
function useTrustSpotlight() {
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const row = document.querySelector('.b-trust')
    if (!row) return
    const names = Array.from(row.querySelectorAll('[data-ca]'))
    if (names.length < 2) return

    let i = 0
    let paused = false
    const light = () => {
      names.forEach((el, k) => el.classList.toggle('ca-lit', k === i))
      i = (i + 1) % names.length
    }
    const hold = () => { paused = true }
    const resume = () => { paused = false }
    row.addEventListener('mouseenter', hold)
    row.addEventListener('mouseleave', resume)

    light()
    const id = setInterval(() => { if (!paused && !document.hidden) light() }, 3400)
    return () => {
      clearInterval(id)
      row.removeEventListener('mouseenter', hold)
      row.removeEventListener('mouseleave', resume)
      names.forEach((el) => el.classList.remove('ca-lit'))
    }
  }, [])
}

export default function Home() {
  useTrustSpotlight()
  return (
    <>
      <section className="b-hero">
        <div className="b-grid-bg" aria-hidden="true" />
        <div className="b-grid-fade" aria-hidden="true" />
        <div className="wrap b-hero-inner">
          <Reveal as="p" className="b-eyebrow">SSL automation platform</Reveal>

          <h1 className="b-h1">
            <LineReveal lines={[
              'The certificate you set up',
              <React.Fragment key="l2">in <span className="b-mark">January still works</span> in December.</React.Fragment>,
            ]} />
          </h1>

          <Reveal as="p" className="b-lede" delay={260}>
            AutomationSSL enrolls your server once with RapidSSL, GeoTrust or Sectigo.
            Every renewal from that point on happens in the background — validated,
            issued, installed. No cron jobs. No 3 a.m. expiry pages.
          </Reveal>

          <Reveal className="b-hero-actions" delay={360}>
            <a className="b-btn-primary" href="#plans"><span>Browse plans <i className="b-arrow" aria-hidden="true">→</i></span></a>
            <a className="b-btn-ghost" href="#how">How it works</a>
          </Reveal>

          <Stagger className="b-trust" step={100}>
            <span data-ca="0">RapidSSL</span>
            <span className="b-trust-sep">·</span>
            <span data-ca="1">GeoTrust</span>
            <span className="b-trust-sep">·</span>
            <span data-ca="2">Sectigo</span>
            <span className="b-trust-sep">·</span>
            <span>47-day lifetime ready</span>
          </Stagger>
        </div>
      </section>

      <section className="b-block b-block-alt" id="plans">
        <div className="wrap">
          <Reveal className="b-head">
            <span className="b-head-eyebrow">Plans</span>
            <h2 className="b-h2">Five automation plans. One outcome: always valid.</h2>
            <p className="b-head-sub">Pick the CA brand and coverage that fits your stack. Every plan includes full lifecycle automation.</p>
          </Reveal>
          <PlanCards />
        </div>
      </section>

      <section className="b-block" id="how">
        <div className="wrap">
          <Reveal className="b-head">
            <span className="b-head-eyebrow">How it works</span>
            <h2 className="b-h2">Your certificates are about to get much shorter.</h2>
            <p className="b-head-sub">Pick an order date and see how many certificates a single year now takes — and how automation handles every one of them.</p>
          </Reveal>
          <AutomationTheatre />
        </div>
      </section>

      <section className="b-block b-block-alt" id="why">
        <div className="wrap">
          <Reveal className="b-head">
            <span className="b-head-eyebrow">Why now</span>
            <h2 className="b-h2">Manual SSL is about to become impossible.</h2>
            <p className="b-head-sub">
              The CA/B Forum is cutting public certificate lifetimes to 47 days by 2029.
              What used to be a yearly chore becomes a task every six weeks — per certificate, per server.
            </p>
          </Reveal>
          <Stagger className="b-stats" step={110}>
            <div className="b-stat">
              <div className="b-stat-num"><CountUp to={47} /></div>
              <div className="b-stat-label">Day lifetimes by 2029</div>
              <p className="b-stat-desc">Lifetimes shrink on a published schedule. Every cut multiplies the reissues you would do by hand.</p>
            </div>
            <div className="b-stat">
              <div className="b-stat-num"><CountUp to={1} /></div>
              <div className="b-stat-label">Command to automate</div>
              <p className="b-stat-desc">Install the agent or point your ACME client once. Everything after that runs on its own.</p>
            </div>
            <div className="b-stat">
              <div className="b-stat-num"><CountUp to={100} suffix="%" /></div>
              <div className="b-stat-label">Hands-off renewals</div>
              <p className="b-stat-desc">Your dashboard tracks every certificate and surfaces anything that needs attention.</p>
            </div>
          </Stagger>
        </div>
      </section>

      <section className="b-cta">
        <div className="wrap">
          <Reveal>
            <h2 className="b-cta-h2">Put your certificates on autopilot today.</h2>
            <p className="b-cta-sub">Every plan is free of charge during the launch testing phase.</p>
            <a className="b-btn-primary b-btn-on-dark" href="#plans"><span>Choose your plan <i className="b-arrow" aria-hidden="true">→</i></span></a>
          </Reveal>
        </div>
      </section>
    </>
  )
}
