import { useParams, Link, Navigate } from 'react-router-dom'
import { bySlug } from '../catalog.js'

export default function Product() {
  const { slug } = useParams()
  const p = bySlug(slug)
  if (!p) return <Navigate to="/" replace />

  return (
    <section className="product-page">
      <div className="wrap">
        <div className="layout">
          <div>
            <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="pill brand">{p.brand}</span>
              <span className="pill">{p.validation} — domain validated</span>
              <span className="pill">{p.coverage}</span>
            </div>
            <h1>{p.name}</h1>
            <p style={{ color: 'var(--ink-soft)', fontSize: '1.05rem' }}>{p.description}</p>
            <ul className="feature-list">
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>

          <aside className="buy-box">
            <span className="eyebrow">Plan</span>
            <div className="price" style={{ margin: '10px 0 4px' }}>
              $0
              <small>free during launch testing — no card required</small>
            </div>
            <div className="kv">
              <div><b>Coverage</b> {p.coverage}</div>
              <div><b>Validation</b> {p.validation}</div>
              <div><b>Plan terms</b> {p.periods.map((m) => `${m} months`).join(' · ')}</div>
              <div><b>Automation</b> full lifecycle</div>
            </div>
            <Link className="btn primary" style={{ display: 'block', textAlign: 'center' }} to={`/order/${p.slug}`}>
              Order this plan free
            </Link>
            <p className="hint" style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: 12 }}>
              Issued through our partnership with the {p.brand} certificate
              authority network.
            </p>
          </aside>
        </div>
      </div>
    </section>
  )
}
