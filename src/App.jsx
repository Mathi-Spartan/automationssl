import { Routes, Route, Link } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Product from './pages/Product.jsx'
import Order from './pages/Order.jsx'
import Status from './pages/Status.jsx'

function Logo() {
  return (
    <Link to="/" className="logo" aria-label="AutomationSSL home">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <circle cx="13" cy="13" r="10" stroke="#135c3b" strokeWidth="2.4" strokeDasharray="47 16" strokeLinecap="round" />
        <path d="M9.5 13.2l2.4 2.4 4.6-4.8" stroke="#1e7a4c" strokeWidth="2.4" strokeLinecap="round" strokeJoin="round" fill="none" />
      </svg>
      Automation<em>SSL</em>
    </Link>
  )
}

export function Header() {
  return (
    <header className="site-header">
      <div className="wrap">
        <Logo />
        <nav className="nav" aria-label="Main">
          <a href="/#plans">Plans</a>
          <a href="/#how">How it works</a>
          <Link to="/status">Order status</Link>
          <a href="/#plans" className="cta">Get started free</a>
        </nav>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div>
          <strong>AutomationSSL</strong> — automated TLS certificate plans
          <br />
          RapidSSL · GeoTrust · Sectigo ACME
        </div>
        <div className="mono">
          Launch testing phase — all plans free of charge.
          <br />© {new Date().getFullYear()} AutomationSSL
        </div>
      </div>
    </footer>
  )
}

export function RenewalLoop() {
  const nodes = [
    { angle: -90, label: 'ISSUE' },
    { angle: 0, label: 'DEPLOY' },
    { angle: 90, label: 'MONITOR' },
    { angle: 180, label: 'RENEW' },
  ]
  const R = 150
  const cx = 200
  const cy = 200
  return (
    <div className="loop-box" aria-hidden="true">
      <svg className="loop-svg" viewBox="0 0 400 400">
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--line)" strokeWidth="2" strokeDasharray="4 7" />
        {nodes.map((n) => {
          const x = cx + R * Math.cos((n.angle * Math.PI) / 180)
          const y = cy + R * Math.sin((n.angle * Math.PI) / 180)
          const ly = n.angle === -90 ? y - 20 : n.angle === 90 ? y + 30 : y + 4
          const lx = n.angle === 0 ? x + 16 : n.angle === 180 ? x - 16 : x
          const anchor = n.angle === 0 ? 'start' : n.angle === 180 ? 'end' : 'middle'
          return (
            <g key={n.label}>
              <circle cx={x} cy={y} r="7" fill="var(--card)" stroke="var(--pine)" strokeWidth="2.5" />
              <text className="loop-node-label" x={lx} y={ly} textAnchor={anchor}>{n.label}</text>
            </g>
          )
        })}
        <g className="loop-orbit">
          <circle cx={cx} cy={cy - R} r="10" fill="var(--cert)" />
        </g>
        <text className="loop-center-big" x={cx} y={cy - 2} textAnchor="middle">valid ✓</text>
        <text className="loop-center-small" x={cx} y={cy + 24} textAnchor="middle">RENEWS AUTOMATICALLY</text>
      </svg>
    </div>
  )
}

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/plan/:slug" element={<Product />} />
          <Route path="/order/:slug" element={<Order />} />
          <Route path="/status" element={<Status />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}
