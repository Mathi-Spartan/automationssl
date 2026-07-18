import React, { useCallback, useEffect, useRef, useState } from 'react'

const CA_BLUE = '#1a6bb5'
const CA_RED = '#b8001a'

const PATHS = {
  agent: {
    tabLabel: 'AutoInstall agent',
    caName: 'RapidSSL certificate authority',
    caMeta: 'api.example.com · DV',
    color: CA_BLUE,
    tint: '#e8f0fa',
    rows: [
      ['Subscription registered', 'order #3575672'],
      ['Agent enrolled', 'mutual TLS'],
      ['HTTP-01 validation', 'api.example.com'],
      ['Certificate issued', 'valid 47 days'],
      ['Renewal scheduled', 'auto · day 31'],
    ],
    beats: [
      { t: 'term', html: '<span class="th-p">$</span> curl -sSL https://autoinstall.easysecurity.in/s.sh | sh', s: 'Running the one-line installer' },
      { t: 'term', html: '<span class="th-dim">agent v2.4 installed — detected nginx 1.24</span>', s: 'Agent detects your web server' },
      { t: 'pkt', dir: 'r', label: 'agent registers', row: 0, s: 'Agent authenticates with the CA' },
      { t: 'row', row: 1, s: 'Mutual TLS handshake complete' },
      { t: 'pkt', dir: 'r', label: 'HTTP-01 challenge', row: 2, s: 'CA verifies you control the domain' },
      { t: 'term', html: '<span class="th-dim">serving /.well-known/acme-challenge/</span>', s: 'Challenge served without your input' },
      { t: 'pkt', dir: 'l', label: 'certificate', row: 3, s: 'Certificate issued and returned' },
      { t: 'term', html: '<span class="th-ok">OK</span> installed to /etc/nginx/ssl — nginx reloaded', s: 'Installed and web server reloaded' },
      { t: 'row', row: 4, s: 'Renewal scheduled automatically' },
      { t: 'term', html: '<span class="th-ok">Done.</span> <span class="th-dim">every future renewal runs without you</span>', s: 'Fully automated' },
    ],
  },
  acme: {
    tabLabel: 'ACME / certbot',
    caName: 'Sectigo ACME certificate-as-a-service',
    caMeta: 'shop.io + wildcard · DV',
    color: CA_RED,
    tint: '#fdeaea',
    rows: [
      ['EAB credentials verified', 'kid 8f2a4c1e'],
      ['ACME account bound', 'RFC 8555'],
      ['DNS-01 validation', '*.shop.io'],
      ['Certificate issued', 'valid 47 days'],
      ['Renewal timer armed', 'certbot.timer'],
    ],
    beats: [
      { t: 'term', html: '<span class="th-p">$</span> certbot register \\', s: 'Register against the ACME endpoint' },
      { t: 'term', html: '    --server https://acme.sectigo.com/v2/DV \\', s: 'Point certbot at Sectigo' },
      { t: 'term', html: '    --eab-kid 8f2a4c1e --eab-hmac-key ********', s: 'External account binding credentials' },
      { t: 'pkt', dir: 'r', label: 'EAB binding', row: 0, s: 'CA verifies your binding key' },
      { t: 'row', row: 1, s: 'ACME account bound to your plan' },
      { t: 'term', html: '<span class="th-p">$</span> certbot certonly -d shop.io -d *.shop.io', s: 'Request the certificate' },
      { t: 'pkt', dir: 'r', label: 'DNS-01 order', row: 2, s: 'DNS challenge published and checked' },
      { t: 'pkt', dir: 'l', label: 'fullchain.pem', row: 3, s: 'Certificate issued and returned' },
      { t: 'term', html: '<span class="th-ok">OK</span> saved to /etc/letsencrypt/live/shop.io/', s: 'Certificate written to disk' },
      { t: 'row', row: 4, s: 'certbot.timer handles every renewal' },
      { t: 'term', html: '<span class="th-ok">Done.</span> <span class="th-dim">renews itself every cycle</span>', s: 'Fully automated' },
    ],
  },
}

export default function AutomationTheatre() {
  const [path, setPath] = useState('agent')
  const [lines, setLines] = useState([])
  const [litRows, setLitRows] = useState([])
  const [pkt, setPkt] = useState(null)
  const [status, setStatus] = useState('Ready')
  const [pct, setPct] = useState(0)
  const [playing, setPlaying] = useState(false)

  const timers = useRef([])
  const stageRef = useRef(null)
  const started = useRef(false)

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }

  const play = useCallback((key) => {
    clearTimers()
    setLines([]); setLitRows([]); setPkt(null); setPct(0); setPlaying(true)
    const d = PATHS[key]
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduce) {
      setLines(d.beats.filter((b) => b.t === 'term').map((b) => b.html))
      setLitRows(d.rows.map((_, i) => i))
      setStatus('Fully automated'); setPct(100); setPlaying(false)
      return
    }

    let delay = 0
    const n = d.beats.length
    d.beats.forEach((b, i) => {
      delay += b.t === 'pkt' ? 1150 : 720
      timers.current.push(setTimeout(() => {
        setStatus(b.s)
        setPct(Math.round(((i + 1) / n) * 100))
        if (b.t === 'term') setLines((L) => [...L, b.html])
        if (b.t === 'row') setLitRows((R) => (R.includes(b.row) ? R : [...R, b.row]))
        if (b.t === 'pkt') {
          setPkt({ dir: b.dir, label: b.label, id: i })
          timers.current.push(setTimeout(() => setPkt(null), 1050))
          if (b.row != null) {
            timers.current.push(setTimeout(() => {
              setLitRows((R) => (R.includes(b.row) ? R : [...R, b.row]))
            }, 900))
          }
        }
        if (i === n - 1) timers.current.push(setTimeout(() => setPlaying(false), 400))
      }, delay))
    })
  }, [])

  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof IntersectionObserver === 'undefined') { play('agent'); return }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && !started.current) { started.current = true; play('agent'); io.unobserve(e.target) }
      })
    }, { threshold: 0.35 })
    io.observe(el)
    return () => { io.disconnect(); clearTimers() }
  }, [play])

  useEffect(() => () => clearTimers(), [])

  const d = PATHS[path]

  const switchPath = (key) => {
    if (key === path) return
    setPath(key)
    started.current = true
    play(key)
  }

  return (
    <div className="th" ref={stageRef}>
      <div className="th-tabs" role="tablist">
        {Object.keys(PATHS).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={path === key}
            className={'th-tab' + (path === key ? ' on' : '')}
            onClick={() => switchPath(key)}
          >
            {PATHS[key].tabLabel}
          </button>
        ))}
      </div>

      <div className="th-stage">
        <div className="th-term">
          <div className="th-term-bar">
            <span className="th-tdot" style={{ background: '#e05252' }} />
            <span className="th-tdot" style={{ background: '#e8a020' }} />
            <span className="th-tdot" style={{ background: '#2eb85c' }} />
            <span className="th-term-host">root@{path === 'agent' ? 'api.example.com' : 'shop.io'}</span>
          </div>
          <div className="th-term-body">
            {lines.map((html, i) => (
              <div className="th-line" key={i} dangerouslySetInnerHTML={{ __html: html }} />
            ))}
            {playing && <div className="th-caret" aria-hidden="true" />}
          </div>
        </div>

        <div className="th-wire" aria-hidden="true">
          <div className="th-track" />
          {pkt && (
            <span
              key={pkt.id}
              className={'th-pkt ' + (pkt.dir === 'r' ? 'th-go-r' : 'th-go-l')}
              style={{ background: d.color }}
            />
          )}
          {pkt && <span className="th-wire-label">{pkt.label}</span>}
        </div>

        <div className="th-ca">
          <div className="th-ca-head">
            <span className="th-ca-mark" style={{ background: d.tint, color: d.color }}>
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path d="M12 2.6 L19.6 6 v6.3c0 4.8-3.4 7.5-7.6 8.9-4.2-1.4-7.6-4.1-7.6-8.9V6z" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <path d="M8.6 12.1l2.4 2.4 4.5-4.7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <div className="th-ca-name">{d.caName}</div>
              <div className="th-ca-meta">{d.caMeta}</div>
            </div>
          </div>
          {d.rows.map((r, i) => (
            <div className={'th-row' + (litRows.includes(i) ? ' on' : '')} key={i}>
              <span className="th-row-dot" />
              <span className="th-row-text">{r[0]}</span>
              <span className="th-row-val">{r[1]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="th-foot">
        <span className="th-status">{status}</span>
        <span className="th-prog"><span className="th-prog-fill" style={{ width: pct + '%' }} /></span>
        <button type="button" className="th-replay" onClick={() => play(path)}>Replay</button>
      </div>
    </div>
  )
}
