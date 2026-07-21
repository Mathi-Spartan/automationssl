import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate, useMatch } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'

export default function DashShell({ children }) {
  const { session, profile } = useAuth()
  const navigate = useNavigate()
  const isReseller = profile?.account_type === 'reseller'

  // While viewing another account, the sidebar must stay inside that view.
  // Hardcoded /dashboard links drop you back into your own account, and a
  // refresh then lands on the wrong page entirely.
  // Two patterns: react-router's '/*' requires a trailing segment, so
  // '/dashboard/as/:id' alone does not match it. Without the exact form the
  // base silently falls back to /dashboard and every sidebar link leaves the
  // impersonated view.
  const asExact = useMatch('/dashboard/as/:customerId')
  const asNested = useMatch('/dashboard/as/:customerId/*')
  const viewingId = asExact?.params?.customerId || asNested?.params?.customerId || null
  const base = viewingId ? `/dashboard/as/${viewingId}` : '/dashboard'
  // Nav describes the account on screen. While impersonating that is the
  // target, not the viewer — a master viewing a retail customer should not
  // see a Customers link.
  // Resolve the viewed account's type so the nav describes what is on
  // screen. RLS already limits this read to the viewer's own subtree.
  const [viewingType, setViewingType] = useState(null)
  const [viewingParent, setViewingParent] = useState(null)
  useEffect(() => {
    if (!viewingId) { setViewingType(null); setViewingParent(null); return }
    let alive = true
    supabase?.from('profiles').select('account_type, parent_reseller_id').eq('id', viewingId).maybeSingle()
      .then(({ data }) => { if (alive) { setViewingType(data?.account_type || null); setViewingParent(data?.parent_reseller_id || null) } })
    return () => { alive = false }
  }, [viewingId])

  const navIsReseller = viewingId ? viewingType === 'reseller' : isReseller
  // Pricing is a sub-reseller's own buy/sell reference. The master has no
  // markup of their own, so it means nothing on their account. A sub-reseller
  // is exactly a reseller WITH a parent, which the shell already knows —
  // no extra column or fetch needed.
  const navIsSubReseller = viewingId
    ? viewingType === 'reseller' && !!viewingParent
    : isReseller && profile?.can_create_resellers !== true
  // Leaving should step back one level, not jump to the top. Drilling
  // master → reseller → customer and hitting exit should land on the
  // reseller's list, which is where you came from.
  const exitTo = viewingParent && viewingParent !== session?.user?.id
    ? `/dashboard/as/${viewingParent}/customers`
    : '/dashboard/customers'

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
          <NavLink to={base} end>
            <span className="ic" aria-hidden="true">▦</span> Overview
          </NavLink>
          {!navIsReseller && (
            <NavLink to={`${base}/workspace`}>
              <span className="ic" aria-hidden="true">◈</span> Workspace
            </NavLink>
          )}
          {!navIsReseller && !viewingId && (
            <NavLink to={`${base}/servers`}>
              <span className="ic" aria-hidden="true">🖥</span> Servers
            </NavLink>
          )}
          {navIsReseller && (
            <NavLink to={`${base}/customers`}>
              <span className="ic" aria-hidden="true">👥</span> Customers
            </NavLink>
          )}
          {navIsSubReseller && (
            <NavLink to={`${base}/pricing`}>
              <span className="ic" aria-hidden="true">◎</span> Pricing
            </NavLink>
          )}
          {navIsReseller && !viewingId && (
            <NavLink to="/dashboard/inventory">
              <span className="ic" aria-hidden="true">▤</span> Inventory
            </NavLink>
          )}

          {viewingId && (
            <NavLink to={exitTo} className="dash-nav-exit">
              <span className="ic" aria-hidden="true">↩</span>
              {exitTo === '/dashboard/customers' ? ' Back to my account' : ' Back one level'}
            </NavLink>
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
