import { useEffect, useState, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { PRODUCTS } from '../catalog.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'

const name = (id) => PRODUCTS.find((p) => p.id === id)?.name || `Product ${id}`

/**
 * Inventory. Caps are ceilings, not reservations — granting does not lock
 * anything. What keeps the master's pool honest is that every order also
 * decrements every ancestor, so the tree total can never exceed the root cap
 * even when grants oversubscribe it.
 */
export default function Inventory() {
  const { session, profile, loading } = useAuth()
  const [rows, setRows] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [renewing, setRenewing] = useState({})
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)

  const isMaster = profile?.can_create_resellers === true
  const meId = session?.user?.id

  const load = useCallback(async () => {
    if (!meId) return
    const { data: allocs, error } = await supabase
      .from('allocations').select('account_id, product_id, cap, used')
    if (error) { setErr(error.message); return }
    setRows(allocs || [])

    const ids = [...new Set((allocs || []).map((a) => a.account_id))]
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles')
        .select('id, full_name, customer_code, account_type, parent_reseller_id').in('id', ids)
      setAccounts(profs || [])
    }

    // Renewals already scheduled inside the next 30 days are inventory that is
    // going to be spent whether or not anyone places an order.
    const soon = new Date(Date.now() + 30 * 86400000).toISOString()
    const { data: ords } = await supabase.from('orders')
      .select('user_id, product_id, api_response, status, consumes_quota')
    const pressure = {}
    ;(ords || []).forEach((o) => {
      if (o.consumes_quota === false) return
      const due = o.api_response?.items?.[0]?.subscription?.next_renewal
      if (!due || due > soon) return
      const k = `${o.user_id}:${o.product_id}`
      pressure[k] = (pressure[k] || 0) + 1
    })
    setRenewing(pressure)
  }, [meId])

  useEffect(() => { load() }, [load])

  async function setCap(accountId, productId, cap) {
    setBusy(`${accountId}:${productId}`); setErr(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/allocation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
        body: JSON.stringify({ account_id: accountId, product_id: productId, cap: Number(cap) }),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.message || 'Could not save the limit.')
      await load()
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(null) }
  }

  if (loading) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard/inventory' }} />
  if (profile?.account_type !== 'reseller') return <Navigate to="/dashboard" replace />
  if (rows === null) return <div className="form-page"><p>Loading…</p></div>

  const mine = rows.filter((r) => r.account_id === meId)
  const others = rows.filter((r) => r.account_id !== meId)
  const acct = (id) => accounts.find((a) => a.id === id)

  const byAccount = {}
  others.forEach((r) => {
    if (!byAccount[r.account_id]) byAccount[r.account_id] = []
    byAccount[r.account_id].push(r)
  })
  // Only accounts one level below this one are this account's to grant.
  const grantable = Object.keys(byAccount).filter((id) => acct(id)?.parent_reseller_id === meId)

  return (
    <div>
      <div className="clm-head">
        <div className="clm-kicker">INVENTORY</div>
        <h1>{isMaster ? 'Inventory' : 'Your inventory'}</h1>
      </div>

      {err && <div className="alert error">{err}</div>}

      <p className="plans-note">
        Every order consumes one unit at each level — the buyer, their reseller, and the
        master — so nothing here can be exceeded from below. Renewals are the exception:
        they cannot be refused, so they may push an account past its limit.
      </p>

      <div className="inv-section-head">{isMaster ? 'Your pool' : 'Your limit'}</div>
      <div className="inv-grid">
        {mine.sort((a, b) => a.product_id - b.product_id).map((r) => {
          const left = r.cap - r.used
          const due = renewing[`${meId}:${r.product_id}`] || 0
          return (
            <div key={r.product_id} className={'inv-card' + (left <= 0 ? ' is-out' : '')}>
              <div className="inv-name">{name(r.product_id)}</div>
              <div className="inv-big">{left < 0 ? 0 : left}<span> left</span></div>
              <div className="inv-sub">{r.used} of {r.cap} used</div>
              {r.used > r.cap && <div className="inv-over">over limit by {r.used - r.cap}</div>}
              {due > 0 && <div className="inv-due">{due} renewing within 30 days</div>}
              {isMaster && (
                <CapInput value={r.cap} busy={busy === `${meId}:${r.product_id}`}
                  onSave={(v) => setCap(meId, r.product_id, v)} label="Pool" />
              )}
            </div>
          )
        })}
      </div>

      {grantable.length > 0 && (
        <>
          <div className="inv-section-head">
            {isMaster ? 'Sub-resellers and their limits' : 'Your customers'}
          </div>
          {grantable.map((id) => {
            const a = acct(id)
            const list = byAccount[id].sort((x, y) => x.product_id - y.product_id)
            return (
              <div key={id} className="inv-acct">
                <div className="inv-acct-head">
                  <span className="inv-acct-name">{a?.full_name || 'Unnamed'}</span>
                  {a?.customer_code && <span className="inv-acct-code">{a.customer_code}</span>}
                </div>
                <table className="inv-table">
                  <thead>
                    <tr><th>Plan</th><th>Used</th><th>Limit</th><th /></tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.product_id} className={r.used > r.cap ? 'is-over' : ''}>
                        <td>{name(r.product_id)}</td>
                        <td className="inv-num">{r.used}</td>
                        <td className="inv-num">{r.cap}</td>
                        <td className="inv-num">
                          <CapInput value={r.cap} busy={busy === `${id}:${r.product_id}`}
                            onSave={(v) => setCap(id, r.product_id, v)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

function CapInput({ value, onSave, busy, label }) {
  const [v, setV] = useState(String(value))
  useEffect(() => { setV(String(value)) }, [value])
  const dirty = String(value) !== v && v !== ''
  return (
    <div className="inv-cap-edit">
      {label && <label>{label}</label>}
      <input type="number" min="0" value={v} disabled={busy}
        onChange={(e) => setV(e.target.value)} />
      <button type="button" className="btn ghost inv-cap-save"
        disabled={!dirty || busy} onClick={() => onSave(v)}>
        {busy ? '…' : 'Save'}
      </button>
    </div>
  )
}
