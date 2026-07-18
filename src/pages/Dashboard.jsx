import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'

function deliverables(order) {
  const item = order?.api_response?.items?.[0] || {}
  const link = item?.autoinstall?.login_sso_link || item?.autoinstall?.manage_sso_link || null
  const acme = {}
  const scan = (obj) => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) scan(v)
      else if (/eab|server_url|acme_account|directory/i.test(k) && v) acme[k] = v
    }
  }
  if (Number(order.product_id) === 300) scan(order.api_response)
  return { setupLink: link, aiStatus: item?.autoinstall?.status || null, acme: Object.keys(acme).length ? acme : null, renewal: item?.subscription?.next_renewal || null }
}

export default function Dashboard() {
  const { session, profile, loading } = useAuth()
  const [orders, setOrders] = useState(null)
  const [servers, setServers] = useState([])
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!session?.user || !supabase) return
    Promise.all([
      supabase.from('orders').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      supabase.from('servers').select('id, name, environment').eq('owner_id', session.user.id).order('name'),
    ]).then(([o, s]) => {
      if (o.error) setErr(o.error.message)
      setOrders(o.data || [])
      setServers(s.data || [])
    })
  }, [session?.user?.id])

  if (loading) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard' }} />

  async function assignServer(orderId, serverId) {
    const { error } = await supabase.from('orders').update({ server_id: serverId || null }).eq('id', orderId)
    if (!error) setOrders(orders.map((o) => (o.id === orderId ? { ...o, server_id: serverId || null } : o)))
  }

  return (
    <div className="form-page wide">
      <span className="eyebrow">Dashboard</span>
      <h1>Your plans{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1>
      <p className="sub">
        Activate automation, check renewals, and tag each plan to the server it runs on.{' '}
        <Link to="/dashboard/servers" style={{ textDecoration: 'underline' }}>Manage servers</Link>
        {profile?.account_type === 'reseller' && (
          <> · <Link to="/dashboard/customers" style={{ textDecoration: 'underline' }}>Your customers</Link></>
        )}
      </p>

      {err && <div className="alert error">{err}</div>}
      {orders && orders.length === 0 && (
        <div className="alert ok">
          No plans yet. <Link to="/#plans" style={{ textDecoration: 'underline' }}>Choose a plan</Link> to get started — everything is free during the testing phase.
        </div>
      )}

      {(orders || []).map((o) => {
        const d = deliverables(o)
        return (
          <div className="alert ok" key={o.id} style={{ marginBottom: 14 }}>
            <strong>{o.product_name}</strong> — status: {o.status}
            <div className="kv" style={{ marginTop: 8 }}>
              <div><b>Order ID</b> {o.gogetssl_order_id}</div>
              {o.domain && <div><b>Domain</b> {o.domain}</div>}
              {d.renewal && <div><b>Next renewal</b> {d.renewal}</div>}
              {d.aiStatus && <div><b>Automation setup</b> {d.aiStatus}</div>}
            </div>

            {d.setupLink && (
              <div style={{ marginTop: 10 }}>
                <a className="btn primary" style={{ display: 'inline-block' }} href={d.setupLink} target="_blank" rel="noreferrer">
                  {d.aiStatus === 'incomplete' ? 'Activate — open setup portal →' : 'Open automation portal →'}
                </a>
              </div>
            )}
            {d.acme && (
              <details style={{ marginTop: 10 }}>
                <summary><strong>ACME enrollment credentials</strong></summary>
                <pre>{JSON.stringify(d.acme, null, 2)}</pre>
              </details>
            )}

            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: '0.82rem', marginRight: 8 }}><b>Server</b></label>
              <select value={o.server_id || ''} onChange={(e) => assignServer(o.id, e.target.value)}>
                <option value="">— not assigned —</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>
                ))}
              </select>
            </div>
          </div>
        )
      })}
    </div>
  )
}
