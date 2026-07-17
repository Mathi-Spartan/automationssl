// Product IDs, periods and capabilities verified against the live GoGetSSL API
// on 2026-07-17 via /products/ and /products/details/{id}.

export const PRODUCTS = [
  {
    id: 400,
    slug: 'rapidssl-automate',
    brand: 'RapidSSL',
    name: 'RapidSSL Plan + Automate',
    coverage: 'Single domain',
    validation: 'DV',
    periods: [12],
    tagline: 'The fastest way to keep one domain permanently secured.',
    description:
      'A RapidSSL domain-validated certificate on a managed automation plan. Your server enrolls once; issuance, installation checks and every renewal after that happen without you touching a terminal.',
    features: [
      'Covers one FQDN (e.g. www.example.com + example.com)',
      'Domain validation — issued in minutes',
      'Automated renewal for the life of the plan',
      'Static site seal included',
      'Free reissues during the plan term',
    ],
  },
  {
    id: 401,
    slug: 'rapidssl-wildcard-automate',
    brand: 'RapidSSL',
    name: 'RapidSSL Wildcard Plan + Automate',
    coverage: 'Wildcard — *.domain',
    validation: 'DV',
    periods: [12],
    tagline: 'Every subdomain covered, every renewal handled.',
    description:
      'One wildcard certificate secures unlimited subdomains under a single domain, with the automation plan keeping it perpetually valid. Add subdomains any time — they are already covered.',
    features: [
      'Secures *.example.com — unlimited subdomains',
      'Domain validation — issued in minutes',
      'Automated renewal for the life of the plan',
      'Static site seal included',
      'Ideal for SaaS tenants and multi-app stacks',
    ],
  },
  {
    id: 402,
    slug: 'geotrust-automate',
    brand: 'GeoTrust',
    name: 'GeoTrust DV Plan + Automate',
    coverage: 'Single domain',
    validation: 'DV',
    periods: [12],
    tagline: 'A globally recognized CA brand, fully automated.',
    description:
      'GeoTrust domain-validated certificate on a managed automation plan. The GeoTrust root heritage with zero-touch lifecycle management — enroll once and forget about expiry dates.',
    features: [
      'Covers one FQDN',
      'GeoTrust — trusted CA brand since 2001',
      'Automated renewal for the life of the plan',
      'Static site seal included',
      'Free reissues during the plan term',
    ],
  },
  {
    id: 403,
    slug: 'geotrust-wildcard-automate',
    brand: 'GeoTrust',
    name: 'GeoTrust DV Wildcard Plan + Automate',
    coverage: 'Wildcard — *.domain',
    validation: 'DV',
    periods: [12],
    tagline: 'GeoTrust wildcard coverage that never lapses.',
    description:
      'Unlimited subdomains under one GeoTrust wildcard certificate, renewed automatically by the plan. The strongest option for teams standardizing on the GeoTrust brand.',
    features: [
      'Secures *.example.com — unlimited subdomains',
      'GeoTrust — trusted CA brand since 2001',
      'Automated renewal for the life of the plan',
      'Static site seal included',
      'Ideal for SaaS tenants and multi-app stacks',
    ],
  },
  {
    id: 300,
    slug: 'sectigo-acme-caas',
    brand: 'Sectigo',
    name: 'Sectigo ACME Certificate-as-a-Service',
    coverage: 'Multi-domain + wildcard SANs (up to 255)',
    validation: 'DV',
    periods: [12, 24, 36],
    featured: true,
    tagline: 'Your servers talk to the CA directly. You do nothing.',
    description:
      'Built on the industry-standard ACME protocol, Sectigo CaaS lets certbot, acme.sh, Caddy, Traefik or any ACME client connect straight to Sectigo\u2019s Certificate Authority and deploy as many certificates as needed. Up to 255 SANs including wildcards, on plans up to 36 months.',
    features: [
      'Standard ACME protocol — works with certbot, acme.sh, Caddy, Traefik, cert-manager',
      'Up to 255 SAN entries, wildcard SANs supported',
      'Plans of 12, 24 or 36 months',
      'Certificates issue and renew fully unattended',
      'Enterprise Sectigo CA infrastructure',
    ],
  },
]

export const bySlug = (slug) => PRODUCTS.find((p) => p.slug === slug)
export const byId = (id) => PRODUCTS.find((p) => p.id === Number(id))
