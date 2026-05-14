import { FastifyInstance, FastifyReply } from 'fastify'
import {
  createSpcAuthenticationRequest,
  verifySpcAuthentication,
} from '../services/spc'

function sendServiceError(
  reply: FastifyReply,
  result: {
    statusCode: number
    error: string
    reason: string
    detail?: string
  },
) {
  return reply.code(result.statusCode).send({
    error: result.error,
    reason: result.reason,
    detail: result.detail,
  })
}

export async function spcRoutes(server: FastifyInstance) {
  const rpId = process.env.RP_ID || 'localhost'
  const rpOrigin = process.env.RP_ORIGIN || 'http://localhost:3004'

  server.get<{ Querystring: { acsTransId: string } }>(
    '/options',
    async (request, reply) => {
      const result = await createSpcAuthenticationRequest({
        acsTransId: request.query.acsTransId,
        rpId,
        rpOrigin,
        log: server.log,
      })

      if (!result.ok) return sendServiceError(reply, result)
      return result.value
    },
  )

  server.post<{
    Body: {
      acsTransId: string
      assertion: Record<string, unknown>
    }
  }>(
    '/verify',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const result = await verifySpcAuthentication({
        acsTransId: request.body.acsTransId,
        assertion: request.body.assertion,
        rpId,
        rpOrigin,
        log: server.log,
      })

      if (!result.ok) return sendServiceError(reply, result)
      return result.value
    },
  )
}
