import { FastifyInstance } from 'fastify'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types'
import { prisma } from '../prisma'

const challengeStore = new Map<string, string>()

export async function webauthnRoutes(server: FastifyInstance) {
  const rpID = process.env.RP_ID || 'localhost'
  const rpName = process.env.RP_NAME || '3DS Passkey MVP'
  const rpOrigin = process.env.RP_ORIGIN || 'http://localhost:3004'

  // GET /webauthn/register/options
  server.get<{ Querystring: { acsTransId: string } }>(
    '/register/options',
    async (request, reply) => {
      const { acsTransId } = request.query

      const transaction = await prisma.transaction.findUnique({
        where: { acsTransId },
        include: { user: { include: { credentials: true } } },
      })

      if (!transaction?.user) {
        return reply.code(404).send({ error: 'Transaction not found' })
      }

      const user = transaction.user

      const options = await generateRegistrationOptions({
        rpID,
        rpName,
        userID: new TextEncoder().encode(user.id),
        userName: user.email || user.cardNumberHash.slice(0, 8),
        userDisplayName: user.email || 'Card User',
        excludeCredentials: user.credentials.map(c => ({
          id: c.credentialId,
          type: 'public-key' as const,
          transports: c.transports as AuthenticatorTransportFuture[],
        })),
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // Windows Hello / Touch ID に強制
          residentKey: 'required',
          userVerification: 'required',
        },
      })

      challengeStore.set(`reg:${acsTransId}`, options.challenge)

      return options
    }
  )

  // POST /webauthn/register/verify
  server.post<{
    Body: {
      acsTransId: string
      credential: Record<string, unknown>
    }
  }>('/register/verify', async (request, reply) => {
    const { acsTransId, credential } = request.body

    const transaction = await prisma.transaction.findUnique({
      where: { acsTransId },
      include: { user: true },
    })

    if (!transaction?.user) {
      return reply.code(404).send({ error: 'Transaction not found' })
    }

    const expectedChallenge = challengeStore.get(`reg:${acsTransId}`)
    if (!expectedChallenge) {
      return reply.code(400).send({ error: 'No challenge found' })
    }

    try {
      const verification = await verifyRegistrationResponse({
        response: credential as unknown as Parameters<typeof verifyRegistrationResponse>[0]['response'],
        expectedChallenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
        requireUserVerification: true,
      })

      if (!verification.verified || !verification.registrationInfo) {
        return reply.code(400).send({ error: 'Verification failed' })
      }

      const { credentialID, credentialPublicKey, counter } = verification.registrationInfo

      const spcCapable = !!(credential as { clientExtensionResults?: { payment?: unknown } })
        .clientExtensionResults?.payment

      await prisma.webAuthnCredential.create({
        data: {
          userId: transaction.user!.id,
          credentialId: credentialID,
          publicKey: Buffer.from(credentialPublicKey),
          signCount: counter,
          aaguid: verification.registrationInfo.aaguid,
          transports: (credential as { response?: { transports?: string[] } }).response?.transports ?? [],
          spcCapable,
        },
      })

      challengeStore.delete(`reg:${acsTransId}`)

      await prisma.transaction.update({
        where: { acsTransId },
        data: {
          authType: 'PASSKEY',
          authResult: 'AUTHENTICATED',
          authenticatedAt: new Date(),
          enrolledPasskey: true,
        },
      })

      return { success: true, credentialId: credentialID }
    } catch (err) {
      server.log.error(err)
      return reply.code(400).send({ error: 'Verification failed' })
    }
  })

  // GET /webauthn/authenticate/options
  server.get<{ Querystring: { acsTransId: string } }>(
    '/authenticate/options',
    async (request, reply) => {
      const { acsTransId } = request.query

      const transaction = await prisma.transaction.findUnique({
        where: { acsTransId },
        include: { user: { include: { credentials: true } } },
      })

      if (!transaction?.user) {
        return reply.code(404).send({ error: 'Transaction not found' })
      }

      const credentials = transaction.user.credentials

      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'required',
        allowCredentials: credentials.map(c => ({
          id: c.credentialId,
          type: 'public-key' as const,
          transports: c.transports as AuthenticatorTransportFuture[],
        })),
      })

      challengeStore.set(`auth:${acsTransId}`, options.challenge)

      return options
    }
  )

  // POST /webauthn/authenticate/verify
  server.post<{
    Body: {
      acsTransId: string
      credential: Record<string, unknown>
    }
  }>('/authenticate/verify', async (request, reply) => {
    const { acsTransId, credential } = request.body

    const transaction = await prisma.transaction.findUnique({
      where: { acsTransId },
      include: { user: { include: { credentials: true } } },
    })

    if (!transaction?.user) {
      return reply.code(404).send({ error: 'Transaction not found' })
    }

    const expectedChallenge = challengeStore.get(`auth:${acsTransId}`)
    if (!expectedChallenge) {
      return reply.code(400).send({ error: 'No challenge found' })
    }

    const credentialId = (credential as { id?: string }).id
    const storedCred = transaction.user.credentials.find(c => c.credentialId === credentialId)

    if (!storedCred) {
      return reply.code(400).send({ error: 'Credential not found' })
    }

    try {
      const verification = await verifyAuthenticationResponse({
        response: credential as unknown as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
        expectedChallenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
        requireUserVerification: true,
        authenticator: {
          credentialID: storedCred.credentialId,
          credentialPublicKey: new Uint8Array(storedCred.publicKey),
          counter: storedCred.signCount,
          transports: storedCred.transports as AuthenticatorTransportFuture[],
        },
      })

      if (!verification.verified) {
        return reply.code(401).send({ error: 'Authentication failed' })
      }

      await prisma.webAuthnCredential.update({
        where: { credentialId: storedCred.credentialId },
        data: {
          signCount: verification.authenticationInfo.newCounter,
          lastUsedAt: new Date(),
        },
      })

      challengeStore.delete(`auth:${acsTransId}`)

      await prisma.transaction.update({
        where: { acsTransId },
        data: { authResult: 'AUTHENTICATED', authenticatedAt: new Date() },
      })

      return { success: true }
    } catch (err) {
      server.log.error(err)
      return reply.code(401).send({ error: 'Authentication failed' })
    }
  })
}
