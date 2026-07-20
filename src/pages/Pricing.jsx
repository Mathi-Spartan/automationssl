import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { PRODUCTS } from '../catalog.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'

const SLABS = [10, 20, 30]

/**
 * A sub-reseller's pricing reference.
 *
 * This is read-only on purpose. Markup is set per customer now, so there is no
 * single number to edit here — the page answers "at what percentage do I earn
 * what?", which is what the panel it replaces was actually being used for.
 * It sat under the customer list, where it took more vertical space than
 * anything else while being the thing looked at least often.
 */
export default function Pricing({ viewAs = null }) {
  const { customerId } = useParams()
  const { session, profile, loading } = useAuth()
  const [scope, setScope] = useState(viewAs)
  const [rows, setRows] = useState([])
  const [err, setErr] = useState(null)

  const scopeId = customerId || viewAs?.id || session?.user?.id

  // When reached through the impersonation route the profile has to be read;
  // RLS already limits this to the viewer's own subtree.
  useEffect(() => {
    if (!customerId || viewAs) return
    let alive = true
    supabase.from('profiles')
      .select('id, full_name, account_type, parent_reseller_id, can_create_resellers')
      .eq('id', customerId).maybeSingle()
      .then(({ data }) => { if (alive) setScope(data || null) })
    return () => { alive = false }
  }, [customerId, viewAs])

  useEffect(() => {
    if (!scopeId) return
    let alive = true
    Promise.all(PRODUCTS.map((p) =>
      supabase.rpc('resolve_price', { buyer: scopeId, prod: p.id })
        .then(({ data, error }) => {
          if (error) throw error
          return { id: p.id, name: p.name, unit: p.priceNote, ...(data?.[0] || {}) }
        })))
      .then((r) => { if (alive) setRows(r) })
      .catch((e) => { if (alive) setErr(e.message || String(e)) })
    return () => { alive = false }
  }, [scopeId])

  const me = scope || profile

  if (loading) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard/pricing' }} />
  if (me && me.account_type !== 'reseller') return <Navigate to="/dashboard" replace />

  const noSlab = rows.length > 0 && rows.every((r) => r.bill_price == null)

  return (
    <div>
      <div className="clm-head">
        <div className="clm-kicker">PRICING</div>
        <h1>Your pricing</h1>
      </div>

      {err && <div className="alert error">{err}</div>}

      {noSlab ? (
        <div className="alert error">
          No discount slab has been set on your account yet, so your buying price
          is not defined. Your provider sets this.
        </div>
      ) : (
        <>
          <p className="plans-note">
            What you pay, and what you would earn at each markup. You set the markup
            per customer when you create them, or by editing them later — so different
            customers can sit on different rows of this table.
          </p>

          <div className="pr-wrap">
            <table className="pr-table">
              <thead>
                <tr>
                  <th className="pr-plan">Plan</th>
                  <th>List</th>
                  <th>You pay</th>
                  {SLABS.map((s) => <th key={s} className="pr-slab">+{s}%</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const list = Number(r.list_price)
                  const cost = Number(r.bill_price)
                  if (!isFinite(list) || !isFinite(cost)) return null
                  return (
                    <tr key={r.id}>
                      <td className="pr-plan">
                        {r.name}<span className="pr-unit">{r.unit}</span>
                      </td>
                      <td className="pr-num pr-muted">${list.toFixed(2)}</td>
                      <td className="pr-num pr-cost">${cost.toFixed(2)}</td>
                      {SLABS.map((s) => {
                        const raw = cost * (1 + s / 100)
                        const charged = Math.min(raw, list)
                        return (
                          <td key={s} className="pr-num">
                            <b>${charged.toFixed(2)}</b>
                            <span className="pr-keep">you keep ${(charged - cost).toFixed(2)}</span>
                            {raw > list && <span className="pr-capped">capped from ${raw.toFixed(2)}</span>}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="pr-note">
            Your customers are never charged above the public list price. A markup that
            would exceed it is clamped, and the affected cell says so.
          </p>
        </>
      )}
    </div>
  )
}
