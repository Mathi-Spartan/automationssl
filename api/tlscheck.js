// GET /api/tlscheck?domain=example.com
// Does a live TLS probe via the SSL Labs / crt.sh approach using
// Node's built-in tls module (available in Vercel Node runtime).
// Returns cert expiry, issuer, days left, validity status.
// Public — no auth required (rate-limited by Vercel edge).

import tls from 'tls'

function probeTLS(domain) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: 'Connection timed out (10s)' })
    }, 10000)

    const cleanDomain = domain.replace(/^\*\./, '').replace(/^https?:\/\//, '').split('/')[0].trim()

    const socket = tls.connect(443, cleanDomain, { servername: cleanDomain, rejectUnauthorized: false }, () => {
      clearTimeout(timeout)
      try {
        const cert = socket.getPeerCertificate(true)
        socket.destroy()
        if (!cert || !cert.subject) {
          resolve({ ok: false, error: 'No certificate returned' })
          return
        }
        const now = Date.now()
        const validFrom = new Date(cert.valid_from)
        const validTo = new Date(cert.valid_to)
        const daysLeft = Math.ceil((validTo.getTime() - now) / 86400000)
        const issuer = cert.issuer?.O || cert.issuer?.CN || 'Unknown'
        const subject = cert.subject?.CN || cleanDomain
        const sans = cert.subjectaltname
          ? cert.subjectaltname.split(', ').map(s => s.replace('DNS:', '')).filter(Boolean)
          : [subject]

        resolve({
          ok: true,
          domain: cleanDomain,
          subject,
          issuer,
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
          daysLeft,
          expired: daysLeft < 0,
          expiringSoon: daysLeft >= 0 && daysLeft <= 30,
          sans: sans.slice(0, 10),
          fingerprint: cert.fingerprint256 || cert.fingerprint || null,
        })
      } catch (e) {
        socket.destroy()
        resolve({ ok: false, error: `Parse error: ${e.message}` })
      }
    })

    socket.on('error', (e) => {
      clearTimeout(timeout)
      resolve({ ok: false, error: e.message })
    })
  })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'GET only' })

  const domain = (req.query.domain || '').trim()
  if (!domain || !/^[*a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
    return res.status(400).json({ error: true, message: 'Valid domain required.' })
  }

  try {
    const result = await probeTLS(domain)
    return res.status(200).json(result)
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message) })
  }
}
