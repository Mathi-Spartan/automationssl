import { Link, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'

export default function DashShell({ children }) {
  const { session, profile } = useAuth()
  const navigate = useNavigate()
  const isReseller = profile?.account_type === 'reseller'

  async function signOut(e) {
    e.preventDefault()
    await supabase?.auth.signOut()
    navigate('/')
  }

  return (
    <div className="dash-shell">
      <aside className="dash-side">
        <Link to="/" className="dash-logo" aria-label="AutomationSSL home">
          <svg width="22" height="22" viewBox="0 0 26 26" fill="none" aria-hidden="true">
            <circle cx="13" cy="13" r="10" stroke="#b4dffc" strokeWidth="2.4" strokeDasharray="47 16" strokeLinecap="round" />
            <path d="M9.5 13.2l2.4 2.4 4.6-4.8" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          </svg>
          Automation<em>SSL</em>
        </Link>

        <nav className="dash-nav" aria-label="Dashboard">
          <NavLink to="/dashboard" end>
            <span className="ic" aria-hidden="true">▦</span> Overview
          </NavLink>
          {!isReseller && (
            <NavLink to="/dashboard/servers">
              <span className="ic" aria-hidden="true">🖥</span> Servers
            </NavLink>
          )}
          {isReseller && (
            <NavLink to="/dashboard/customers">
              <span className="ic" aria-hidden="true">👥</span> Customers
            </NavLink>
          )}
          <a href="/#plans">
            <span className="ic" aria-hidden="true">＋</span> Buy plans
          </a>
          {!isReseller && (
            <Link to="/status">
              <span className="ic" aria-hidden="true">☰</span> Order status
            </Link>
          )}
        </nav>

        <div className="dash-user">
          <div className="dash-user-meta">
            <span className="dash-user-name">{profile?.full_name || 'Account'}</span>
            <span className="dash-user-mail">{session?.user?.email}</span>
            <span className="dash-user-role">{isReseller ? 'Reseller account' : 'Customer account'}</span>
          </div>
          <a href="/" onClick={signOut} className="dash-signout">Sign out</a>
          <span className="dash-family">an <a href="https://easysecurity.in" target="_blank" rel="noreferrer">easysecurity.in</a> product</span>
        </div>
      </aside>

      <main className="dash-main">{children}</main>
    </div>
  )
}
