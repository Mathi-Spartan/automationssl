import React, { useEffect, useRef, useState } from 'react'

/* Shared IntersectionObserver hook — fires once when element enters view. */
function useInView(options = {}) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { setSeen(true); io.unobserve(e.target) }
        })
      },
      { threshold: options.threshold ?? 0.15, rootMargin: options.rootMargin ?? '0px 0px -40px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [options.threshold, options.rootMargin])
  return [ref, seen]
}

/* Fade + rise into place when scrolled into view. */
export function Reveal({ children, delay = 0, as: Tag = 'div', className = '', ...rest }) {
  const [ref, seen] = useInView()
  return (
    <Tag
      ref={ref}
      className={`mo-reveal${seen ? ' mo-in' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/* Reveals its children one after another. */
export function Stagger({ children, step = 90, as: Tag = 'div', className = '', ...rest }) {
  const [ref, seen] = useInView()
  const kids = React.Children.toArray(children)
  return (
    <Tag ref={ref} className={className} {...rest}>
      {kids.map((child, i) =>
        React.isValidElement(child)
          ? React.cloneElement(child, {
              key: child.key ?? i,
              className: `mo-reveal${seen ? ' mo-in' : ''} ${child.props.className || ''}`.trim(),
              style: { ...(child.props.style || {}), transitionDelay: `${i * step}ms` },
            })
          : child
      )}
    </Tag>
  )
}

/* Headline lines that slide up from a masked edge. */
export function LineReveal({ lines = [], className = '', step = 100 }) {
  const [ref, seen] = useInView({ threshold: 0.3 })
  return (
    <span ref={ref} className={`mo-lines${seen ? ' mo-in' : ''} ${className}`.trim()}>
      {lines.map((ln, i) => (
        <span className="mo-line" key={i}>
          <span className="mo-line-i" style={{ transitionDelay: `${i * step}ms` }}>{ln}</span>
        </span>
      ))}
    </span>
  )
}

/* Number that counts up from zero on reveal. */
export function CountUp({ to, suffix = '', prefix = '', duration = 1200, decimals = 0 }) {
  const [ref, seen] = useInView({ threshold: 0.4 })
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!seen) return
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVal(to); return
    }
    let raf = 0, start = null
    const tick = (ts) => {
      if (!start) start = ts
      const p = Math.min((ts - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(to * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [seen, to, duration])
  const shown = decimals > 0 ? val.toFixed(decimals) : Math.round(val).toLocaleString()
  return <span ref={ref}>{prefix}{shown}{suffix}</span>
}

/* Step sequence that lights each dot in turn and fills the connector. */
export function StepSequence({ steps = [], interval = 700 }) {
  const [ref, seen] = useInView({ threshold: 0.35 })
  const [active, setActive] = useState(-1)
  useEffect(() => {
    if (!seen) return
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setActive(steps.length - 1); return
    }
    const timers = steps.map((_, i) => setTimeout(() => setActive(i), i * interval))
    return () => timers.forEach(clearTimeout)
  }, [seen, steps.length, interval])

  return (
    <div className="seq" ref={ref}>
      <div className="seq-line">
        <div
          className="seq-line-fill"
          style={{ width: seen ? `${((active + 1) / steps.length) * 100}%` : '0%' }}
        />
      </div>
      {steps.map((s, i) => (
        <div className={`seq-step${i <= active ? ' on' : ''}`} key={i}>
          <div className="seq-dot">{i <= active ? <i className="ti ti-check" aria-hidden="true" /> : i + 1}</div>
          <div className="seq-tag">{s.tag}</div>
          <div className="seq-title">{s.title}</div>
          <div className="seq-desc">{s.desc}</div>
        </div>
      ))}
    </div>
  )
}
