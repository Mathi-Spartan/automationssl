import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase, supabaseConfigured } from '../lib/supabase.js'

function AuthForm({ mode }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const dest = location.state?.from || '/dashboard'

  if (!supabaseConfigured)
    return <div className="alert error">Account system is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).</div>

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        })
        if (err) throw err
        if (data.session) navigate(dest, { replace: true })
        else setNotice('Account created. Please check your inbox and confirm your email, then sign in.')
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (err) throw err
        navigate(dest, { replace: true })
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="form-page">
      <span className="eyebrow">{mode === 'signup' ? 'Create account' : 'Sign in'}</span>
      <h1>{mode === 'signup' ? 'Join AutomationSSL' : 'Welcome back'}</h1>
      <p className="sub">
        {mode === 'signup'
          ? 'One account to purchase plans, activate automation and manage your servers.'
          : 'Sign in to manage your plans and servers.'}
      </p>

      <form onSubmit={submit}>
        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="fullname">Full name</label>
            <input id="fullname" required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          </div>
        )}
        <div className="field">
          <label htmlFor="aemail">Email</label>
          <input id="aemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="apass">Password</label>
          <input id="apass" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          {mode === 'signup' && <p className="hint">At least 8 characters.</p>}
        </div>

        {error && <div className="alert error" role="alert"><strong>{error}</strong></div>}
        {notice && <div className="alert ok">{notice}</div>}

        <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%', padding: '13px' }}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p style={{ marginTop: 16 }} className="hint">
        {mode === 'signup'
          ? <>Already have an account? <Link to="/login" style={{ textDecoration: 'underline' }}>Sign in</Link></>
          : <>Accounts are provisioned by the AutomationSSL team during the testing phase.</>}
      </p>
    </div>
  )
}

export const Login = () => <AuthForm mode="login" />
// Signup intentionally not exported during the testing phase — accounts are
// provisioned by the team. Re-export when public signup opens.

