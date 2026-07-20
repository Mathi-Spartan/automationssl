import React, { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { PRODUCTS } from '../catalog.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'

/**
 * In-portal plan list.
 *
 * The public landing page at /#plans renders catalog.js strings, which are the
 * master's list price. That is only correct for a master's direct customer — a
 * sub-reseller's customer sent there sees a price nobody will ever charge them.
 * Every figure on this page comes from resolve_price for the signed-in account,
 * the same resolver api/order.js uses when the order is actually placed.
 */
export default function Plans() {
  const { session, profile, loading } = useAuth()
  const [priceFor, setPriceFor] = useState({})
  const [pricing, setPricing] = useState(true)

  const buyer = session?.user?.id

  useEffect(() => {
    if (!buyer) return
    let alive = true
    setPricing(true)
    Promise.all(PRODUCTS.map((pr) =>
      supabase.rpc('resolve_price', { buyer, prod: pr.id })
        .then(({ data }) => [pr.id, data?.[0] || null])))
      .then((pairs) => {
        if (!alive) return
        setPriceFor(Object.fromEntries(pairs))
        setPricing(false)
      })
    return () => { alive = false }
  }, [buyer])

  if (loading) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard/plans' }} />

  const isReseller = profile?.account_type === 'reseller'

  return (
    <div>
      <div className="clm-head">
        <div className="clm-kicker">CERTIFICATE LIFECYCLE MANAGER</div>
        <h1>{isReseller ? 'Buy plans' : 'Available plans'}</h1>
      </div>

      <p className="plans-note">
        {isReseller
          ? 'Prices shown are your buying price. What you charge your own customers is set by your markup slab.'
          : 'Prices shown are your account price, set by your provider.'}
      </p>

      <div className="of-plan-grid">
        {PRODUCTS.map((p) => {
          const r = priceFor[p.id]
          const resolved = r?.sale_price != null
          const blocked = r && r.sale_price == null
          return (
            <div key={p.id} className={'of-plan-card plans-card' + (blocked ? ' is-blocked' : '')}>
              <div className="of-plan-name">{p.name}</div>
              <div className="of-plan-meta">{p.coverage} · {p.validation}</div>
              <div className="of-plan-price">
                {/* No fallback to p.price here. Showing list price while the
                    resolver is still loading would flash a number this account
                    may never be charged. */}
                {resolved ? `$${Number(r.sale_price).toFixed(2)}` : (pricing ? '—' : '')}
                <span style={{ fontSize: '0.72rem', color: '#9aa8b5', marginLeft: 4 }}>{p.priceNote}</span>
                {resolved && Number(r.sale_price) < Number(r.list_price) && (
                  <span className="of-plan-was">was ${Number(r.list_price).toFixed(2)}</span>
                )}
              </div>
              {blocked && <div className="of-plan-blocked">{r.reason}</div>}
              {resolved && (
                <Link to={`/order/${p.slug}`} className="btn primary plans-buy">Order now →</Link>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
