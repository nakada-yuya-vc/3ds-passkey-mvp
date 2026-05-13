import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { threedsRoutes } from './routes/threeds'
import { webauthnRoutes } from './routes/webauthn'
import { spcRoutes } from './routes/spc'
import { adminRoutes } from './routes/admin'

const server = Fastify({
  logger: {
    // Avoid dumping raw credentialIds / aaguids into shared log infra. Dev still sees
    // structured logs; the values are redacted to "[redacted]" before serialization.
    redact: {
      paths: [
        'credentialId',
        'credentialID',
        'storedIds',
        'aaguid',
        'aaguids',
        '*.credentialId',
        '*.credentialID',
        '*.aaguid',
      ],
      censor: '[redacted]',
    },
  },
})

// Build a small allowlist from env so the API doesn't accept arbitrary origins.
// The three browser-facing apps (merchant, challenge UI / ACS, dashboard) each
// have their own dev port; production overrides via env.
const corsAllowlist = [
  process.env.MERCHANT_URL || 'http://localhost:3002',
  process.env.ACS_URL || 'http://localhost:3004',
  process.env.DASHBOARD_URL || 'http://localhost:3003',
]

server.register(cors, {
  origin: (origin, cb) => {
    // Allow same-origin / server-to-server (no Origin header) and the explicit allowlist.
    if (!origin || corsAllowlist.includes(origin)) return cb(null, true)
    server.log.warn({ origin }, '[cors] rejected origin')
    cb(new Error('Origin not allowed'), false)
  },
  credentials: true,
})

// Global rate limit per IP — applied to every route. Auth-sensitive verify
// endpoints (OTP, WebAuthn assertion, SPC assertion) override this with a
// tighter bucket via `config.rateLimit` on the individual route so brute-force
// against signatures and OTPs is throttled even when one user is busy.
server.register(rateLimit, {
  max: 60,
  timeWindow: '1 minute',
})

server.register(threedsRoutes, { prefix: '/threeds' })
server.register(webauthnRoutes, { prefix: '/webauthn' })
server.register(spcRoutes, { prefix: '/spc' })
server.register(adminRoutes, { prefix: '/admin' })

server.get('/health', async () => ({ status: 'ok' }))

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001
    await server.listen({ port, host: '0.0.0.0' })
    console.log(`ACS server running on http://localhost:${port}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()
