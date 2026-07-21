import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { deliverables } from './Dashboard.jsx'

/**
 * The certificate workspace: servers, plans and domains as one linked map.
 *
 * Three columns rendered from a single state object, SVG wires between
 * connected nodes, click-to-trace in both directions, and drag-to-assign
 * where the backend genuinely permits it:
 *
 *   plan → server   direct update; RLS "tag own orders" allows only the
 *                   OWNER, so this drag is live on the customer's own login
 *                   and disabled (with the reason) under impersonation.
 *   domain → plan   /api/domains DELETE + POST; that API is reseller-only
 *                   by design (pro-rated billing lands on the reseller), so
 *                   this drag is live under impersonation and disabled with
 *                   the API's own explanation on a customer login. CaaS
 *                   (product 300) plans only — AIS domains are agent-managed
 *                   at the CA and render without a grip.
 *
 * A domain move deliberately consumes a quota unit: the add is a real
 * pro-rated issue at the CA, so the ledger reflects what actually happened.
 */

const CAAS = 300

export default function Workspace() {
  const { customerId } = useParams()
  const { session, profile, loading } = useAuth()
  const [orders, setOrders] = useState(null)
  const [servers, setServers] = useState(null)
  const [target, setTarget] = useState(null)
  const [sel, setSel] = useState(null)
  const [busy, setBusy] = useState(null)
  const [toasts, setToasts] = useState([])
  const [picker, setPicker] = useState(null)
  const dragRef = useRef(null)
  const wrapRef = useRef(null)
  const [wires, setWires] = useState([])

  const impersonating = !!customerId
  const scopeId = customerId || session?.user?.id

  const toast = useCallback((msg, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600)
  }, [])

  useEffect(() => {
    if (!customerId) { setTarget(null); return }
    let alive = true
    supabase.from('profiles').select('id, full_name, account_type')
      .eq('id', customerId).maybeSingle()
      .then(({ data }) => { if (alive) setTarget(data || null) })
    return () => { alive = false }
  }, [customerId])

  const load = useCallback(async () => {
    if (!scopeId) return
    const [o, sv] = await Promise.all([
      supabase.from('orders')
        .select('id, product_id, product_name, status, server_id, api_response, sale_price, created_at')
        .eq('user_id', scopeId).neq('status', 'cancelled').order('created_at'),
      supabase.from('servers')
        .select('id, name, hostname, environment, webserver')
        .eq('owner_id', scopeId).order('created_at'),
    ])
    setOrders(o.data || [])
    setServers(sv.data || [])
  }, [scopeId])

  useEffect(() => { load() }, [load])

  /* ── derive the graph ── */
  const plans = (orders || []).map((o) => {
    const d = deliverables(o)
    return {
      id: o.id,
      dbId: o.id,
      label: o.product_name || 'Plan',
      orderNo: o.api_response?.order?.order_id || o.id.slice(0, 8),
      caas: o.product_id === CAAS,
      server: o.server_id || 'unassigned',
      price: o.sale_price != null ? `$${Number(o.sale_price).toFixed(2)}` : '',
      perDomain: o.product_id === CAAS,
      ok: !!d.activated,
      slabel: d.activated ? 'Automated' : (o.product_id === CAAS ? 'Configure ACME' : 'Install agent'),
      domains: (d.vendorDomains || []).map((x) => ({
        name: typeof x === 'string' ? x : (x?.name || ''),
        ok: typeof x === 'string' ? !!d.activated : (x?.status ? String(x.status).toLowerCase() === 'active' : !!d.activated),
      })).filter((x) => x.name),
    }
  })
  const domains = plans.flatMap((p) => p.domains.map((d) => ({ ...d, plan: p.id, caas: p.caas })))
  const serverNodes = [
    ...(servers || []).map((s) => ({ id: s.id, name: s.name || s.hostname || 'server', meta: [s.hostname, s.environment, s.webserver].filter(Boolean).join(' · ') })),
    { id: 'unassigned', name: 'No server', meta: 'plans not linked to a server' },
  ]

  /* ── selection chain ── */
  const chain = (() => {
    if (!sel) return null
    const srvs = new Set(); const pls = new Set(); const doms = new Set()
    if (sel.kind === 'server') {
      srvs.add(sel.id)
      plans.filter((p) => p.server === sel.id).forEach((p) => { pls.add(p.id); p.domains.forEach((d) => doms.add(d.name)) })
    }
    if (sel.kind === 'plan') {
      const p = plans.find((x) => x.id === sel.id); if (!p) return null
      pls.add(p.id); srvs.add(p.server); p.domains.forEach((d) => doms.add(d.name))
    }
    if (sel.kind === 'domain') {
      const d = domains.find((x) => x.name === sel.id); if (!d) return null
      doms.add(d.name); pls.add(d.plan); srvs.add(plans.find((p) => p.id === d.plan)?.server)
    }
    return { srvs, pls, doms }
  })()

  const faded = (kind, id) => {
    if (!chain) return false
    if (kind === 'server') return !chain.srvs.has(id)
    if (kind === 'plan') return !chain.pls.has(id)
    return !chain.doms.has(id)
  }

  /* ── wires: measured from the DOM after layout ── */
  const measure = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const wr = wrap.getBoundingClientRect()
    const pt = (el, side) => {
      const r = el.getBoundingClientRect()
      return [side === 'r' ? r.right - wr.left : r.left - wr.left, r.top + r.height / 2 - wr.top]
    }
    const out = []
    plans.forEach((p) => {
      const a = wrap.querySelector(`[data-node="server:${p.server}"]`)
      const b = wrap.querySelector(`[data-node="plan:${p.id}"]`)
      if (a && b) {
        const [x1, y1] = pt(a, 'r'); const [x2, y2] = pt(b, 'l'); const mx = (x1 + x2) / 2
        const hot = chain && chain.srvs.has(p.server) && chain.pls.has(p.id)
        out.push({ d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, hot, dim: !!chain && !hot })
      }
    })
    domains.forEach((dm) => {
      const a = wrap.querySelector(`[data-node="plan:${dm.plan}"]`)
      const b = wrap.querySelector(`[data-node="domain:${dm.name}"]`)
      if (a && b) {
        const [x1, y1] = pt(a, 'r'); const [x2, y2] = pt(b, 'l'); const mx = (x1 + x2) / 2
        const hot = chain && chain.pls.has(dm.plan) && chain.doms.has(dm.name)
        out.push({ d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, hot, dim: !!chain && !hot })
      }
    })
    setWires(out)
  }, [orders, servers, sel])          // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') { setSel(null); setPicker(null) } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])

  /* ── plan → server ── */
  async function movePlan(planId, serverId) {
    if (impersonating) {
      toast('Server tags are set from the customer\u2019s own login.', 'warn'); return
    }
    const sid = serverId === 'unassigned' ? null : serverId
    setBusy(planId)
    // Read the row back: RLS refusals here are silent zero-row updates.
    const { data, error } = await supabase.from('orders')
      .update({ server_id: sid }).eq('id', planId).select('id, server_id').maybeSingle()
    setBusy(null)
    if (error || !data) { toast('Could not move the plan \u2014 ' + (error?.message || 'not permitted'), 'warn'); return }
    toast(sid ? 'Plan moved.' : 'Plan detached from its server.')
    setSel({ kind: 'plan', id: planId })
    load()
  }

  /* ── domain → plan (CaaS ↔ CaaS, reseller only) ── */
  async function moveDomain(name, fromPlanId, toPlanId) {
    if (!impersonating) {
      toast('Domains are added by your provider \u2014 pro-rated billing goes to them.', 'warn'); return
    }
    const from = plans.find((p) => p.id === fromPlanId)
    const to = plans.find((p) => p.id === toPlanId)
    if (!from?.caas || !to?.caas) { toast('Domains move between ACME plans only \u2014 AIS domains are agent-managed.', 'warn'); return }
    setBusy(name)
    const { data: sess } = await supabase.auth.getSession()
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` }
    const del = await fetch('/api/domains', { method: 'DELETE', headers: H, body: JSON.stringify({ order_id: fromPlanId, domain: name }) })
    const delBody = await del.json().catch(() => ({}))
    if (!del.ok || delBody.error) { setBusy(null); toast(delBody.message || 'Could not detach the domain.', 'warn'); return }
    const add = await fetch('/api/domains', { method: 'POST', headers: H, body: JSON.stringify({ order_id: toPlanId, domain: name }) })
    const addBody = await add.json().catch(() => ({}))
    if (!add.ok || addBody.error) {
      // A real removal happened at the CA; put the domain back where it was
      // rather than leaving it covered by nothing.
      await fetch('/api/domains', { method: 'POST', headers: H, body: JSON.stringify({ order_id: fromPlanId, domain: name }) }).catch(() => {})
      setBusy(null)
      toast(addBody.message || 'Move failed \u2014 domain restored to its original plan.', 'warn')
      load(); return
    }
    setBusy(null)
    toast(`${name} re-issuing under the new plan \u2014 one inventory unit used.`)
    setSel({ kind: 'domain', id: name })
    load()
  }

  /* ── drag plumbing, with a click picker for touch ── */
  const onDragStart = (kind, id) => (e) => { dragRef.current = { kind, id }; e.dataTransfer.setData('text/plain', id) }
  const canDrop = (kind, id) => {
    const d = dragRef.current
    if (!d) return false
    if (d.kind === 'plan' && kind === 'server') return plans.find((p) => p.id === d.id)?.server !== id
    if (d.kind === 'domain' && kind === 'plan') {
      const dm = domains.find((x) => x.name === d.id)
      const to = plans.find((p) => p.id === id)
      return dm && to && dm.plan !== id && dm.caas && to.caas
    }
    return false
  }
  const onDrop = (kind, id) => (e) => {
    e.preventDefault()
    const d = dragRef.current; dragRef.current = null
    if (!d) return
    if (d.kind === 'plan' && kind === 'server') movePlan(d.id, id)
    if (d.kind === 'domain' && kind === 'plan') moveDomain(d.id, d.plan ?? domains.find((x) => x.name === d.id)?.plan, id)
  }

  if (loading) return <div className="form-page"><p>Loading…</p></div>
  if (!session) return <Navigate to="/login" replace state={{ from: '/dashboard/workspace' }} />
  const shown = target || profile
  if (shown && shown.account_type === 'reseller' && !impersonating) return <Navigate to="/dashboard" replace />

  const ready = orders !== null && servers !== null

  return (
    <div>
      <div className="clm-head">
        <div className="clm-kicker">CERTIFICATE WORKSPACE</div>
        <h1>{impersonating ? `${target?.full_name || 'Customer'}'s workspace` : 'Your workspace'}</h1>
      </div>
      <p className="plans-note">
        Servers, plans and domains — one map. Click anything to trace its connections
        {impersonating
          ? '; drag domains between ACME plans to move them. Server tags are set from the customer\u2019s own login.'
          : '; drag plans onto servers to organise them. Domains are managed by your provider.'}
      </p>

      {!ready ? <p className="plans-note">Loading the map…</p> : (
        <div className="ws-wrap" ref={wrapRef}>
          <svg className="ws-wires" aria-hidden="true">
            {wires.map((w, i) => (
              <path key={i} d={w.d} className={'ws-wire' + (w.hot ? ' hot' : '') + (w.dim ? ' dim' : '')} />
            ))}
          </svg>
          <div className="ws-board">
            <div className="ws-col">
              <h3>Servers <span>{serverNodes.length - 1}</span></h3>
              {serverNodes.map((sv) => {
                const pls = plans.filter((p) => p.server === sv.id)
                const nd = pls.reduce((n, p) => n + p.domains.length, 0)
                return (
                  <div key={sv.id} data-node={`server:${sv.id}`}
                    className={'ws-node' + (sel?.kind === 'server' && sel.id === sv.id ? ' sel' : '') + (faded('server', sv.id) ? ' faded' : '')}
                    onClick={() => setSel(sel?.kind === 'server' && sel.id === sv.id ? null : { kind: 'server', id: sv.id })}
                    onDragOver={(e) => { if (canDrop('server', sv.id)) { e.preventDefault(); e.currentTarget.classList.add('dropok') } }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('dropok')}
                    onDrop={(e) => { e.currentTarget.classList.remove('dropok'); onDrop('server', sv.id)(e) }}>
                    <div className="ws-nm">{sv.name}</div>
                    <div className="ws-mt">{sv.meta}</div>
                    <div className="ws-row">
                      <span className="ws-pill mut">{pls.length} plan{pls.length === 1 ? '' : 's'}</span>
                      <span className="ws-pill mut">{nd} domain{nd === 1 ? '' : 's'}</span>
                      {pls.some((p) => !p.caas) && <span className="ws-pill ais">AIS</span>}
                      {pls.some((p) => p.caas) && <span className="ws-pill acme">ACME</span>}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="ws-col">
              <h3>Plans <span>{plans.length}</span></h3>
              {plans.length === 0 && <p className="ws-empty">No plans yet — buy one and it appears here.</p>}
              {plans.map((p) => (
                <div key={p.id} data-node={`plan:${p.id}`}
                  draggable={!impersonating}
                  onDragStart={onDragStart('plan', p.id)}
                  className={'ws-node' + (sel?.kind === 'plan' && sel.id === p.id ? ' sel' : '') + (faded('plan', p.id) ? ' faded' : '') + (busy === p.id ? ' busy' : '')}
                  onClick={() => setSel(sel?.kind === 'plan' && sel.id === p.id ? null : { kind: 'plan', id: p.id })}
                  onDragOver={(e) => { if (canDrop('plan', p.id)) { e.preventDefault(); e.currentTarget.classList.add('dropok') } }}
                  onDragLeave={(e) => e.currentTarget.classList.remove('dropok')}
                  onDrop={(e) => { e.currentTarget.classList.remove('dropok'); onDrop('plan', p.id)(e) }}>
                  {!impersonating && <span className="ws-grip" aria-hidden="true">⠿</span>}
                  <div className="ws-nm">{p.label}</div>
                  <div className="ws-mt">#{p.orderNo} · {p.domains.length} domain{p.domains.length === 1 ? '' : 's'} · on {p.server === 'unassigned' ? 'no server' : (serverNodes.find((s) => s.id === p.server)?.name || 'server')}</div>
                  <div className="ws-row">
                    <span className={'ws-pill ' + (p.ok ? 'ok' : 'warn')}><i className={'ws-dt ' + (p.ok ? 'g' : 'a')} />{p.slabel}</span>
                    <span className={'ws-pill ' + (p.caas ? 'acme' : 'ais')}>{p.caas ? 'ACME' : 'AIS'}</span>
                    {p.price && <span className="ws-price">{p.price}<em>/yr{p.perDomain ? ' · per-domain' : ''}</em></span>}
                  </div>
                  {!impersonating && (
                    <button type="button" className="ws-assign" onClick={(e) => { e.stopPropagation(); setPicker(picker === p.id ? null : p.id) }}>
                      Assign ▾
                    </button>
                  )}
                  {picker === p.id && (
                    <div className="ws-picker" onClick={(e) => e.stopPropagation()}>
                      {serverNodes.filter((s) => s.id !== p.server).map((s) => (
                        <button key={s.id} type="button" onClick={() => { setPicker(null); movePlan(p.id, s.id) }}>→ {s.name}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="ws-col">
              <h3>Domains <span>{domains.length}</span></h3>
              {domains.length === 0 && <p className="ws-empty">Domains appear as your plans issue certificates.</p>}
              {domains.map((dm) => (
                <div key={dm.name} data-node={`domain:${dm.name}`}
                  draggable={impersonating && dm.caas}
                  onDragStart={(e) => { dragRef.current = { kind: 'domain', id: dm.name, plan: dm.plan }; e.dataTransfer.setData('text/plain', dm.name) }}
                  className={'ws-node ws-dnode' + (sel?.kind === 'domain' && sel.id === dm.name ? ' sel' : '') + (faded('domain', dm.name) ? ' faded' : '') + (busy === dm.name ? ' busy' : '')}
                  onClick={() => setSel(sel?.kind === 'domain' && sel.id === dm.name ? null : { kind: 'domain', id: dm.name })}
                  title={dm.caas ? undefined : 'AIS domains are managed by the installer agent'}>
                  {impersonating && dm.caas && <span className="ws-grip" aria-hidden="true">⠿</span>}
                  {!dm.caas && <span className="ws-lock" aria-hidden="true" title="Agent-managed">🛡</span>}
                  <div className="ws-nm mono">{dm.name}</div>
                  <div className="ws-row"><span className={'ws-pill ' + (dm.ok ? 'ok' : 'warn')}><i className={'ws-dt ' + (dm.ok ? 'g' : 'a')} />{dm.ok ? 'Active' : 'Pending'}</span></div>
                </div>
              ))}
            </div>
          </div>
          <div className="ws-legend">
            <span><i className="ws-dt g" /> Active / automated</span>
            <span><i className="ws-dt a" /> Pending or needs action</span>
            <span className="ws-legend-r">
              {impersonating
                ? 'Moving a domain re-issues it under the target plan and uses one inventory unit.'
                : 'Esc clears the trace. Your provider manages domain changes.'}
            </span>
          </div>
        </div>
      )}

      <div className="ws-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'ws-toast' + (t.tone === 'warn' ? ' warn' : '')}>
            <i className={'ws-dt ' + (t.tone === 'warn' ? 'a' : 'g')} />{t.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
