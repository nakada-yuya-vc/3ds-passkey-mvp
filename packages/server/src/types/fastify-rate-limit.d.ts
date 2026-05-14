declare module '@fastify/rate-limit' {
  import type { FastifyPluginCallback } from 'fastify'

  const rateLimit: FastifyPluginCallback<Record<string, unknown>>
  export default rateLimit
}
