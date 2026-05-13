import { FastifyInstance } from 'fastify'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types'
import { prisma } from '../prisma'

const challengeStore = new Map<string, string>()

export async function spcRoutes(server: FastifyInstance) {
  const rpID = process.env.RP_ID || 'localhost'
  const rpOrigin = process.env.RP_ORIGIN || 'http://localhost:3004'

  // GET /spc/options
  server.get<{ Querystring: { acsTransId: string } }>(
    '/options',
    async (request, reply) => {
      const { acsTransId } = request.query

      const transaction = await prisma.transaction.findUnique({
        where: { acsTransId },
        include: { user: { include: { credentials: true } } },
      })

      if (!transaction?.user) {
        return reply.code(404).send({ error: 'Transaction not found' })
      }

      const spcCredentials = transaction.user.credentials
      if (spcCredentials.length === 0) {
        return reply.code(400).send({ error: 'No credentials found' })
      }

      const { randomBytes } = await import('crypto')
      const challenge = randomBytes(32).toString('base64url')
      challengeStore.set(`spc:${acsTransId}`, challenge)

      // .env historically uses MERCHANT_URL; accept either name. SPC requires payeeOrigin to be HTTPS,
      // so we coerce http:// to https:// (Chrome only displays this string; it doesn't fetch it).
      const merchantOrigin =
        process.env.MERCHANT_ORIGIN || process.env.MERCHANT_URL || 'http://localhost:3002'
      const payeeOrigin = merchantOrigin.replace(/^http:\/\//, 'https://')

      server.log.info(
        {
          acsTransId,
          rpID,
          payeeOrigin,
          credentialCount: spcCredentials.length,
          aaguids: spcCredentials.map(c => c.aaguid),
        },
        '[spc] options issued'
      )

      return {
        challenge,
        rpId: rpID,
        payeeOrigin,
        credentials: spcCredentials.map(c => ({
          credentialId: c.credentialId,
          spcCapable: c.spcCapable,
          transports: c.transports,
        })),
        merchantName: transaction.merchantName,
        amount: transaction.purchaseAmount,
        currency: transaction.purchaseCurrency,
      }
    }
  )

  // POST /spc/verify
  server.post<{
    Body: {
      acsTransId: string
      assertion: Record<string, unknown>
    }
  }>('/verify', async (request, reply) => {
    const { acsTransId, assertion } = request.body

    const transaction = await prisma.transaction.findUnique({
      where: { acsTransId },
      include: { user: { include: { credentials: true } } },
    })

    if (!transaction?.user) {
      return reply.code(404).send({ error: 'Transaction not found' })
    }

    const expectedChallenge = challengeStore.get(`spc:${acsTransId}`)
    if (!expectedChallenge) {
      return reply.code(400).send({ error: 'No challenge found' })
    }

    const credentialId = (assertion as { id?: string }).id
    const storedCred = transaction.user.credentials.find(
      c => c.credentialId === credentialId
    )

    if (!storedCred) {
      return reply.code(400).send({ error: 'Credential not found' })
    }

    try {
      // SPC assertions set clientDataJSON.type to "payment.get" (not "webauthn.get").
      // @simplewebauthn/server rejects unknown types by default, so explicitly allow it.
      // Signature/challenge/RPID verification otherwise follows the standard WebAuthn rules.
      const verification = await verifyAuthenticationResponse({
        response: assertion as unknown as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
        expectedChallenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
        expectedType: 'payment.get',
        requireUserVerification: true,
        authenticator: {
          credentialID: storedCred.credentialId,
          credentialPublicKey: new Uint8Array(storedCred.publicKey),
          counter: storedCred.signCount,
          transports: storedCred.transports as AuthenticatorTransportFuture[],
        },
      })

      if (!verification.verified) {
        return reply.code(401).send({ error: 'SPC verification failed' })
      }

      await prisma.webAuthnCredential.update({
        where: { credentialId: storedCred.credentialId },
        data: {
          signCount: verification.authenticationInfo.newCounter,
          lastUsedAt: new Date(),
        },
      })

      challengeStore.delete(`spc:${acsTransId}`)

      await prisma.transaction.update({
        where: { acsTransId },
        data: {
          authType: 'PASSKEY_SPC',
          authResult: 'AUTHENTICATED',
          authenticatedAt: new Date(),
        },
      })

      server.log.info({ acsTransId, credentialId }, '[spc] authenticated')
      return { success: true }
    } catch (err) {
      server.log.error(err)
      return reply.code(401).send({ error: 'SPC verification failed' })
    }
  })
}
