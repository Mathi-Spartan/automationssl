import React, { useCallback, useEffect, useRef, useState } from 'react'

const CA_BLUE = '#1a6bb5'
const CA_RED = '#b8001a'
const CA_AMBER = '#c26a00'

const SCENARIOS = {
  'agent-apache': {
    group: 'agent',
    host: 'api.example.com',
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
      { t: 'term', html: '<span class="th-dim">agent v2.4 installed — detected Apache 2.4.58</span>', s: 'Agent detects Apache' },
      { t: 'pkt', dir: 'r', label: 'agent registers', row: 0, s: 'Agent authenticates with the CA' },
      { t: 'row', row: 1, s: 'Mutual TLS handshake complete' },
      { t: 'pkt', dir: 'r', label: 'HTTP-01 challenge', row: 2, s: 'CA verifies you control the domain' },
      { t: 'term', html: '<span class="th-dim">serving /.well-known/acme-challenge/</span>', s: 'Challenge served without your input' },
      { t: 'pkt', dir: 'l', label: 'certificate', row: 3, s: 'Certificate issued and returned' },
      { t: 'term', html: '<span class="th-ok">OK</span> written to /etc/ssl/api.example.com/', s: 'Certificate and key written to disk' },
      { t: 'term', html: '<span class="th-ok">OK</span> apachectl graceful — vhost :443 live', s: 'Apache reloaded with no dropped connections' },
      { t: 'row', row: 4, s: 'Renewal scheduled automatically' },
      { t: 'term', html: '<span class="th-ok">Done.</span> <span class="th-dim">every future renewal runs without you</span>', s: 'Fully automated' },
    ],
  },
  'agent-iis': {
    group: 'agent',
    host: 'WIN-APP01',
    prompt: 'PS',
    caName: 'GeoTrust certificate authority',
    caMeta: 'portal.example.com · DV',
    color: CA_AMBER,
    tint: '#fff2e2',
    rows: [
      ['Subscription registered', 'order #3575681'],
      ['Agent enrolled', 'mutual TLS'],
      ['HTTP-01 validation', 'portal.example.com'],
      ['Certificate issued', 'valid 47 days'],
      ['Binding updated', 'IIS site :443'],
    ],
    beats: [
      { t: 'term', html: '<span class="th-p">PS></span> iwr https://autoinstall.easysecurity.in/s.ps1 -UseB | iex', s: 'Running the PowerShell installer' },
      { t: 'term', html: '<span class="th-dim">agent v2.4 installed — detected IIS 10.0</span>', s: 'Agent detects IIS' },
      { t: 'pkt', dir: 'r', label: 'agent registers', row: 0, s: 'Agent authenticates with the CA' },
      { t: 'row', row: 1, s: 'Mutual TLS handshake complete' },
      { t: 'pkt', dir: 'r', label: 'HTTP-01 challenge', row: 2, s: 'CA verifies you control the domain' },
      { t: 'term', html: '<span class="th-dim">temporary handler added to Default Web Site</span>', s: 'Challenge served without your input' },
      { t: 'pkt', dir: 'l', label: 'certificate', row: 3, s: 'Certificate issued and returned' },
      { t: 'term', html: '<span class="th-ok">OK</span> imported to LocalMachine\\WebHosting', s: 'Certificate imported to the Windows store' },
      { t: 'term', html: '<span class="th-ok">OK</span> HTTPS binding updated — old cert unbound', s: 'IIS binding switched to the new certificate' },
      { t: 'row', row: 4, s: 'Binding updated on the IIS site' },
      { t: 'term', html: '<span class="th-ok">Done.</span> <span class="th-dim">every future renewal runs without you</span>', s: 'Fully automated' },
    ],
  },
  acme: {
    group: 'acme',
    host: 'shop.io',
    caName: 'Sectigo ACME certificate-as-a-service',
    caMeta: 'shop.io + wildcard · DV',
    color: CA_RED,
    tint: '#fdeaea',
    rows: [
      ['EAB credentials verified', 'kid 8f2a4c1e'],
      ['ACME account bound', 'RFC 8555'],
      ['DNS-01 validation', '*.shop.io'],
      ['Certificate issued', 'valid 47 days'],
      ['Renewal timer armed', 'systemd timer'],
    ],
    beats: [
      { t: 'term', html: '<span class="th-p">$</span> certbot register \\', s: 'Register against the ACME endpoint' },
      { t: 'term', html: '    --server https://acme.sectigo.com/v2/DV \\', s: 'Point your client at Sectigo' },
      { t: 'term', html: '    --config-dir /etc/ssl/acme \\', s: 'Keep everything under your own path' },
      { t: 'term', html: '    --eab-kid 8f2a4c1e --eab-hmac-key ********', s: 'External account binding credentials' },
      { t: 'pkt', dir: 'r', label: 'EAB binding', row: 0, s: 'CA verifies your binding key' },
      { t: 'row', row: 1, s: 'ACME account bound to your plan' },
      { t: 'term', html: '<span class="th-p">$</span> certbot certonly -d shop.io -d *.shop.io', s: 'Request the certificate' },
      { t: 'pkt', dir: 'r', label: 'DNS-01 order', row: 2, s: 'DNS challenge published and checked' },
      { t: 'pkt', dir: 'l', label: 'fullchain.pem', row: 3, s: 'Certificate issued and returned' },
      { t: 'term', html: '<span class="th-ok">OK</span> saved to /etc/ssl/acme/live/shop.io/', s: 'Certificate written to your own path' },
      { t: 'row', row: 4, s: 'The renewal timer handles every cycle' },
      { t: 'term', html: '<span class="th-ok">Done.</span> <span class="th-dim">renews itself every cycle</span>', s: 'Fully automated' },
    ],
  },
}

const GROUPS = [
  { key: 'agent', label: 'AutoInstall agent', first: 'agent-apache' },
  { key: 'acme', label: 'ACME / certbot', first: 'acme' },
]
const AGENT_TABS = [
  { key: 'agent-apache', label: 'Apache · Linux' },
  { key: 'agent-iis', label: 'IIS · Windows' },
]

export default function AutomationTheatre() {
  const [scene, setScene] = useState('agent-apache')
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
    const d = SCENARIOS[key]
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
    if (!el || typeof IntersectionObserver === 'undefined') { play('agent-apache'); return }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && !started.current) { started.current = true; play('agent-apache'); io.unobserve(e.target) }
      })
    }, { threshold: 0.35 })
    io.observe(el)
    return () => { io.disconnect(); clearTimers() }
  }, [play])

  useEffect(() => () => clearTimers(), [])

  const d = SCENARIOS[scene]
  const group = d.group

  const switchScene = (key) => {
    if (key === scene) return
    setScene(key)
    started.current = true
    play(key)
  }

  return (
    <div className="th" ref={stageRef}>
      <div className="th-tabs" role="tablist">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            role="tab"
            aria-selected={group === g.key}
            className={'th-tab' + (group === g.key ? ' on' : '')}
            onClick={() => switchScene(g.key === 'agent' ? 'agent-apache' : 'acme')}
          >
            {g.label}
          </button>
        ))}
      </div>

      {group === 'agent' && (
        <div className="th-subtabs" role="tablist">
          {AGENT_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={scene === t.key}
              className={'th-subtab' + (scene === t.key ? ' on' : '')}
              onClick={() => switchScene(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="th-stage">
        <div className="th-term">
          <div className="th-term-bar">
            <span className="th-tdot" style={{ background: '#e05252' }} />
            <span className="th-tdot" style={{ background: '#e8a020' }} />
            <span className="th-tdot" style={{ background: '#2eb85c' }} />
            <span className="th-term-host">{d.prompt === 'PS' ? '' : 'root@'}{d.host}</span>
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
        <button type="button" className="th-replay" onClick={() => play(scene)}>Replay</button>
      </div>
    </div>
  )
}
