import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/* Certificate lifetime ratchet — CA/Browser Forum schedule.
   Maximum lifetime is decided by the certificate's ISSUE date. */
const RATCHET = [
  { from: '2029-03-15', days: 47 },
  { from: '2027-03-15', days: 100 },
  { from: '2026-03-15', days: 200 },
  { from: '0000-01-01', days: 398 },
]

const DAY = 86400000
const TERM_DAYS = 365

function maxLifetimeOn(date) {
  const iso = date.toISOString().slice(0, 10)
  for (const r of RATCHET) if (iso >= r.from) return r.days
  return 398
}

function buildTimeline(startISO) {
  const start = new Date(startISO + 'T00:00:00Z')
  if (Number.isNaN(start.getTime())) return null
  const end = new Date(start.getTime() + TERM_DAYS * DAY)
  const slices = []
  let cursor = new Date(start.getTime())
  let guard = 0

  while (cursor < end && guard < 40) {
    guard += 1
    const cap = maxLifetimeOn(cursor)
    const remaining = Math.round((end - cursor) / DAY)
    const life = Math.min(cap, remaining)
    if (life <= 0) break
    const sliceEnd = new Date(cursor.getTime() + life * DAY)
    slices.push({
      startsOn: cursor.toISOString().slice(0, 10),
      days: life,
      cap,
      shown: life,
      endsOn: sliceEnd.toISOString().slice(0, 10),
      partial: life < cap,
    })
    cursor = sliceEnd
  }

  const n = slices.length
  slices.forEach((sl, i) => {
    sl.tone = rampAt(n <= 1 ? 0 : i / (n - 1))
  })

  return {
    start, end, slices,
    total: slices.length,
    renewals: Math.max(0, slices.length - 1),
  }
}

function fmt(iso) {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function fmtShort(iso) {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

function fmtSlice(iso) {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/* Blue -> orange -> yellow. Hue routed up through violet/red (212 -> 386)
   so the ramp never passes through green. Returns HSL parts plus whether
   the swatch is light enough to need dark text. */
function rampAt(t) {
  let h, sat, lum
  if (t <= 0.55) {
    const k = t / 0.55
    const e = k * k * 0.55 + k * 0.45
    h = Math.round(212 + (386 - 212) * e) % 360
    sat = Math.round(52 + (88 - 52) * e)
    lum = Math.round(34 + (52 - 34) * e)
  } else {
    const k = (t - 0.55) / 0.45
    h = Math.round(26 + (45 - 26) * k)
    sat = Math.round(88 + (95 - 88) * k)
    lum = Math.round(52 + (57 - 52) * k)
  }
  return { h, sat, lum, dark: t > 0.55 }
}

const PRESETS = [
  { label: 'Today', iso: new Date().toISOString().slice(0, 10) },
  { label: 'Mar 2027', iso: '2027-03-20' },
  { label: 'Mar 2029', iso: '2029-03-20' },
]

const METHODS = [
  {
    key: 'agent',
    icon: 'ti-server-cog',
    title: 'Agent install',
    steps: [
      'Open the setup portal from your dashboard.',
      'Install the agent on your server — once per box.',
      'Add your domain. It validates, installs, and reinstalls at every renewal.',
    ],
    foot: 'Works on any server type.',
    plans: 'RapidSSL and GeoTrust +Automate',
  },
  {
    key: 'acme',
    icon: 'ti-terminal-2',
    title: 'ACME',
    steps: [
      'Copy the ACME credentials from your dashboard.',
      'Register the client you already run — certbot, acme.sh, Caddy, cert-manager.',
      'Your client issues and renews on its own schedule.',
    ],
    foot: 'Needs an ACME-compatible client or server.',
    plans: 'All five plans',
  },
]

export default function AutomationTheatre() {
  const [startISO, setStartISO] = useState(PRESETS[0].iso)
  const [drawn, setDrawn] = useState(0)
  const [armed, setArmed] = useState(false)
  const rootRef = useRef(null)
  const timer = useRef(null)

  const model = useMemo(() => buildTimeline(startISO), [startISO])

  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }

  const play = useCallback((count) => {
    stop()
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setDrawn(count); return }
    setDrawn(0)
    let i = 0
    timer.current = setInterval(() => {
      i += 1
      setDrawn(i)
      if (i >= count) stop()
    }, 260)
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') { setArmed(true); return }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { setArmed(true); io.unobserve(e.target) }
      })
    }, { threshold: 0.25 })
    io.observe(el)
    return () => { io.disconnect(); stop() }
  }, [])

  useEffect(() => {
    if (!armed || !model) return
    play(model.total)
  }, [armed, model, play])

  useEffect(() => () => stop(), [])

  if (!model) return null

  const { slices, total, renewals, start, end } = model
  const endISO = end.toISOString().slice(0, 10)

  return (
    <div className="lc" ref={rootRef}>

      <div className="lc-controls">
        <label className="lc-ctl">
          <span className="lc-ctl-label">Certificate ordered on</span>
          <input
            type="date"
            className="lc-date"
            value={startISO}
            min="2026-01-01"
            max="2032-12-31"
            onChange={(e) => { if (e.target.value) setStartISO(e.target.value) }}
          />
        </label>
        <div className="lc-presets">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={'lc-preset' + (startISO === p.iso ? ' on' : '')}
              onClick={() => setStartISO(p.iso)}
            >{p.label}</button>
          ))}
          <button
            type="button"
            className="lc-replay"
            onClick={() => play(model.total)}
            aria-label="Replay the timeline"
            title="Replay"
          ><i className="ti ti-refresh" aria-hidden="true" /></button>
        </div>
      </div>

      <div className="lc-panel">
        <div className="lc-panel-head">
          <div className="lc-panel-title">
            One 365-day order, starting {fmt(startISO)}
          </div>
          <div className="lc-panel-note">
            Each block is one certificate. Its length is capped by the day it is issued.
          </div>
        </div>

        <div className="lc-track-wrap">
          <div className="lc-axis">
            <span>{fmtShort(startISO)}</span>
            <span>{fmtShort(endISO)}</span>
          </div>

          <div className={'lc-track' + (drawn >= slices.length ? ' done' : ' running')}>
            {slices.map((s, i) => (
              <div
                key={s.startsOn}
                className={'lc-slice' + (i < drawn ? ' in' : '') + (i === 0 ? ' first' : '') + (s.partial ? ' partial' : '') + (i === drawn - 1 ? ' newest' : '') + (s.tone.dark ? ' ink' : '')}
                style={{
                  flexGrow: s.shown,
                  transitionDelay: (i * 40) + 'ms',
                  '--i': i,
                  '--tone': s.tone.h,
                  '--sat': s.tone.sat,
                  '--lum': s.tone.lum,
                }}
                title={s.partial
                  ? `${s.days}-day certificate issued ${fmt(s.startsOn)}, expires ${fmt(s.endsOn)} — only ${s.days} days of the term remained, so it is issued short of the ${s.cap}-day maximum`
                  : `${s.days}-day certificate issued ${fmt(s.startsOn)}, expires ${fmt(s.endsOn)}`}
              >
                <span className="lc-slice-days">{s.days}d</span>
                <span className="lc-slice-exp">{fmtSlice(s.startsOn)} <i className="lc-slice-arr" aria-hidden="true">→</i> {fmtSlice(s.endsOn)}</span>
              </div>
            ))}
          </div>

          <div className="lc-legend">
            <span className="lc-legend-item"><i className="lc-dot" aria-hidden="true" />each block shows the days it covers, and the dates it runs between</span>
          </div>
        </div>

        <div className="lc-stats">
          <div className="lc-stat">
            <span className="lc-stat-num">{total}</span>
            <span className="lc-stat-label">certificates issued across the term</span>
          </div>
          <div className="lc-stat">
            <span className="lc-stat-num lc-stat-warn">{renewals}</span>
            <span className="lc-stat-label">renewals you would run by hand</span>
          </div>
          <div className="lc-stat lc-stat-good">
            <span className="lc-stat-num">0</span>
            <span className="lc-stat-label">renewals you run with automation</span>
          </div>
        </div>
      </div>

      <div className="lc-methods">
        {METHODS.map((m) => (
          <div className="lc-method" key={m.key}>
            <div className="lc-method-head">
              <span className="lc-method-icon"><i className={'ti ' + m.icon} aria-hidden="true" /></span>
              <span className="lc-method-title">{m.title}</span>
            </div>
            <ol className="lc-method-steps">
              {m.steps.map((s, i) => (
                <li key={i}>
                  <span className="lc-method-n">{String(i + 1).padStart(2, '0')}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <div className="lc-method-foot">
              {m.foot} <strong>{m.plans}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="lc-rule">
        <i className="ti ti-info-circle" aria-hidden="true" />
        <p>
          <strong>RapidSSL and GeoTrust +Automate support both methods</strong> and install on any
          server — pick whichever suits you. <strong>Sectigo ACME CaaS is ACME only</strong>, and
          covers up to 255 domains on a single subscription.
        </p>
      </div>

    </div>
  )
}
