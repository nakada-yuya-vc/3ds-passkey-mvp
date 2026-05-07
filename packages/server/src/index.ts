import Fastify from 'fastify'
import cors from '@fastify/cors'
import { threedsRoutes } from './routes/threeds'
import { webauthnRoutes } from './routes/webauthn'
import { spcRoutes } from './routes/spc'
import { adminRoutes } from './routes/admin'

const server = Fastify({ logger: true })

server.register(cors, {
  origin: true,
  credentials: true,
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
