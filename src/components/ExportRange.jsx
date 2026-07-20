import React from 'react'

/**
 * Date range picker for exports.
 *
 * Shared deliberately. The dashboard had presets while the billing statement
 * had no date filter at all — it stamped the current month on the sheet and
 * then included every order ever placed. One control means the two cannot
 * disagree about what a period is.
 *
 * Calls onPick({ from, to, label, slug }). from/to are null for all time.
 * `label` is what belongs on a sheet header; `slug` is for the filename.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const dmy = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const iso = (d) => d.toISOString().slice(0, 10)

/* Calendar months, newest first. Billing runs on months, and 'last 30 days'
   is not one: on 20 August it spans two and matches no invoice anyone raises. */
function recentMonths(n = 6) {
  const out = []
  const now = new Date()
  for (let i = 0; i < n; i += 1) {
    const from = new Date(now.getFullYear(), now.getMonth() - i, 1, 0, 0, 0, 0)
    // Day 0 of the next month is the last day of this one, so month length,
    // leap years and DST are the calendar's problem rather than ours.
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59, 999)
    out.push({
      from,
      to,
      label: `${MONTHS[from.getMonth()]} ${from.getFullYear()}`,
      slug: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`,
    })
  }
  return out
}

const PRESETS = [
  ['Today', 0, 'ti-calendar-event'],
  ['Last 7 days', 7, 'ti-calendar-week'],
  ['Last 30 days', 30, 'ti-calendar-month'],
  ['Last 90 days', 90, 'ti-calendar-stats'],
  ['Last 12 months', 365, 'ti-calendar'],
]

export default function ExportRange({ onPick, disabled = false, busy = false, label = 'Export' }) {
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState('month')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const ref = React.useRef(null)

  React.useEffect(() => {
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function esc(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc) }
  }, [])

  const months = React.useMemo(() => recentMonths(6), [])

  const pick = (range) => { setOpen(false); onPick(range) }

  return (
    <div className="export-wrap" ref={ref}>
      <button type="button" className="btn ghost" disabled={disabled || busy}
        aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {busy ? 'Preparing…' : label}
        <i className="ti ti-chevron-down" style={{ fontSize: 11, verticalAlign: -1, marginLeft: 4 }} aria-hidden="true" />
      </button>

      {open && (
        <div className="export-panel">
          <div className="export-tabs">
            {[['month', 'Month'], ['quick', 'Quick'], ['custom', 'Custom']].map(([k, t]) => (
              <button key={k} type="button"
                className={'export-tab' + (tab === k ? ' on' : '')}
                onClick={() => setTab(k)}>{t}</button>
            ))}
          </div>

          {tab === 'month' && months.map((m) => (
            <button key={m.slug} type="button" className="export-preset" onClick={() => pick(m)}>
              <i className="ti ti-calendar-month" style={{ fontSize: 13, color: '#3375b1', flexShrink: 0 }} aria-hidden="true" />
              {m.label}
            </button>
          ))}

          {tab === 'quick' && (
            <>
              {PRESETS.map(([text, days, icon]) => (
                <button key={text} type="button" className="export-preset" onClick={() => {
                  const t = new Date(); t.setHours(23, 59, 59, 999)
                  const f = new Date(); f.setDate(f.getDate() - days); f.setHours(0, 0, 0, 0)
                  pick({ from: f, to: t, label: `${text} (${dmy(f)} – ${dmy(t)})`, slug: text.toLowerCase().replace(/\s+/g, '-') })
                }}>
                  <i className={'ti ' + icon} style={{ fontSize: 13, color: '#3375b1', flexShrink: 0 }} aria-hidden="true" />
                  {text}
                </button>
              ))}
              <button type="button" className="export-preset"
                onClick={() => pick({ from: null, to: null, label: 'All time', slug: 'all-time' })}>
                <i className="ti ti-infinity" style={{ fontSize: 13, color: '#3375b1', flexShrink: 0 }} aria-hidden="true" />
                All time
              </button>
            </>
          )}

          {tab === 'custom' && (
            <div className="export-custom">
              <div className="export-custom-row">
                <label htmlFor="exp-from">From</label>
                <input id="exp-from" type="date" value={from} max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="export-custom-row">
                <label htmlFor="exp-to">To</label>
                <input id="exp-to" type="date" value={to} min={from || undefined}
                  onChange={(e) => setTo(e.target.value)} />
              </div>
              <button type="button" className="btn primary export-custom-go"
                disabled={!from || !to}
                onClick={() => {
                  const f = new Date(from); f.setHours(0, 0, 0, 0)
                  const t = new Date(to); t.setHours(23, 59, 59, 999)
                  if (f > t) return
                  pick({ from: f, to: t, label: `${dmy(f)} – ${dmy(t)}`, slug: `${iso(f)}-to-${iso(t)}` })
                }}>
                Export range
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
