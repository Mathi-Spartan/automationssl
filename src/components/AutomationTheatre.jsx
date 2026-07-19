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
    reissues: Math.max(0, slices.length - 1),
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
      'Add your domain. It validates, installs, and reinstalls at every reissue.',
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

/* Fixed sets so every visitor sees the same sequence. The times are
   illustrative of when an expiry can fall, not data from any account. */
const MANUAL_TIMES = ['Tue 09:14', 'Sat 22:40', 'Thu 03:12', 'Mon 18:05', 'Sun 06:33', 'Fri 23:51', 'Wed 02:27']
const AUTO_FACES = ['\u{1F60A}', '\u{1F604}', '\u{1F44D}', '\u{1F60E}', '\u{1F64C}', '\u2728', '\u{1F60C}', '\u{1F389}']
const AUTO_LINES = [
  'All set — nothing needed',
  'Handled while you worked',
  'Done, no ticket raised',
  'Reissued overnight',
  'You did not lift a finger',
  'Quietly taken care of',
  'Still hands-off',
  'Another one, automatically',
]

function ReissueCompare({ slices, drawn, onReplay }) {
  const n = slices.length
  // drawn is the same counter that drives the chip track above, so a chip
  // and its comparison step land on the same tick.
  const done = drawn >= n
  const shown = Math.min(drawn - 1, n - 1)
  const manual = shown < 0 ? 0 : shown
  const label = shown === 0 ? 'Original certificate installed' : `Reissue ${shown} installed`

  return (
    <div className="rc">
      <div className="rc-top">
        <div>
          <div className="rc-title">What that means for you</div>
          <div className="rc-sub">Same year, same certificates — the difference is who does the work.</div>
        </div>
        <div className="rc-controls">
          <span className="rc-clock">{done ? 'One year complete' : shown < 0 ? 'Ready' : `Certificate ${shown + 1} of ${n}`}</span>
          <button type="button" className="rc-replay" onClick={onReplay}>⟳ Replay</button>
        </div>
      </div>

      <div className="rc-grid">
        <div className={'rc-panel' + (manual >= 3 ? ' strain' : '')}>
          <div className="rc-head"><i className="rc-dot bad" aria-hidden="true" />Reissuing by hand</div>
          <div className="rc-note">Someone has to remember, every time</div>
          <div className="rc-bar">
            {slices.map((sl, i) => (
              <span key={sl.startsOn}
                className={'rc-cell' + (i <= shown ? ' on' : '') + (i > 0 && i <= shown ? ' gap' : '')} />
            ))}
          </div>
          <div className="rc-alerts" aria-hidden="true">
            {MANUAL_TIMES.slice(0, Math.max(0, manual)).map((t, i) => (
              <span className={'rc-alert' + (i === manual - 1 ? ' fresh' : '')} key={t}>⚠ {t}</span>
            ))}
          </div>
          <div className="rc-event">
            {done ? (
              <><b className="bad">{n - 1} interruptions</b><span>several of them outside working hours</span></>
            ) : shown < 0 ? <span className="rc-idle">Waiting to start…</span> : shown === 0 ? (
              <><b>Certificate 1 installed</b><span>the only one that happens on its own</span></>
            ) : (
              <><b className="bad">Reissue {shown} due</b><span>drop everything: request, install, verify</span></>
            )}
          </div>
          <div className="rc-tally"><span className="rc-num bad">{done ? n - 1 : manual}</span><span className="rc-num-l">{(done ? n - 1 : manual) === 1 ? 'reissue' : 'reissues'} you run</span></div>
        </div>

        <div className="rc-panel win">
          <div className="rc-head"><i className="rc-dot good" aria-hidden="true" />With +Automate or CaaS</div>
          <div className="rc-note">Set up once, then nothing</div>
          <div className="rc-bar">
            {slices.map((sl, i) => (
              <span key={sl.startsOn}
                className={'rc-cell' + (i <= shown ? ' on' : '')}
                style={i <= shown ? { background: `hsl(${sl.tone.h} ${sl.tone.sat}% ${sl.tone.lum}%)` } : undefined} />
            ))}
          </div>
          <div className="rc-calm">
            <span className="rc-face" key={done ? 'done' : shown} aria-hidden="true">
              {shown < 0 ? '' : done ? '\u{1F389}' : AUTO_FACES[shown % AUTO_FACES.length]}
            </span>
            <span className="rc-calm-t">
              {shown < 0 ? 'Ready when you are' : done ? 'Never needed you once' : AUTO_LINES[shown % AUTO_LINES.length]}
            </span>
          </div>
          <div className="rc-event">
            {done ? (
              <><b className="good">Nothing to do</b><span>{n} certificates, none touched by hand</span></>
            ) : shown < 0 ? <span className="rc-idle">Waiting to start…</span> : (
              <><b className="good">{label}</b><span>issued and deployed automatically</span></>
            )}
          </div>
          <div className="rc-tally"><span className="rc-num good">0</span><span className="rc-num-l">reissues you run</span></div>
        </div>
      </div>
    </div>
  )
}

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
    }, 420)
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

  const { slices, start, end } = model
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
                <span className="lc-tip" aria-hidden="true">{
                  (i === 0 ? 'Original certificate' : `Reissue ${i}`) +
                  ` · ${s.days} days · ${fmt(s.startsOn)} → ${fmt(s.endsOn)}` +
                  (s.partial ? ' · short — term ends' : '')
                }</span>
                <span className="lc-slice-seq">{i === 0 ? 'ORIGINAL' : `REISSUE ${i}`}</span>
                <span className="lc-slice-days">{s.days}d</span>
                <span className="lc-slice-exp">{fmtSlice(s.startsOn)} <i className="lc-slice-arr" aria-hidden="true">→</i> {fmtSlice(s.endsOn)}</span>
              </div>
            ))}
          </div>

          <div className="lc-legend">
            <span className="lc-legend-item"><i className="lc-dot" aria-hidden="true" />each block shows the days it covers, and the dates it runs between</span>
          </div>
        </div>

        <ReissueCompare slices={slices} drawn={drawn} onReplay={() => play(model.total)} />
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
