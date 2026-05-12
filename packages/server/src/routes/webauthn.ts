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
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        // Per W3C SPC spec / Chrome / MDN, the property is `isPayment: true`.
        // (An earlier draft of the spec used `isPaymentCredential`; Chrome silently ignores
        // the unknown key, so the credential is created without the SPC marker and any later
        // SPC ceremony fails with NotAllowedError at show() time.)
        // https://developer.mozilla.org/en-US/docs/Web/API/Payment_Request_API/Using_secure_payment_confirmation
        extensions: {
          payment: { isPayment: true },
        } as Record<string, unknown>,
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

      // payment extension は登録時に clientExtensionResults へ出力されない (入力専用)。
      // 登録オプションに常に payment extension を含めているため spcCapable は常に true (claim 値)。
      // 実際に SPC が通るかは authenticator + ブラウザ依存。診断のため AAGUID と既知ラベルをログ出力する:
      const spcCapable = true
      const aaguid = verification.registrationInfo.aaguid
      const KNOWN_AAGUIDS: Record<string, string> = {
        '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
        '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
        '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
        'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
        'adce0002-35bc-c60a-648b-0b25f1f05503': 'iCloud Keychain',
        'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain (managed)',
        'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
        'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
      }
      const authenticatorLabel = KNOWN_AAGUIDS[aaguid] ?? `Unknown (${aaguid})`
      server.log.info(
        { credentialID, aaguid, authenticatorLabel, spcCapable },
        '[register] credential created — authenticator identified by AAGUID',
      )

      await prisma.webAuthnCredential.create({
        data: {
          userId: transaction.user!.id,
          credentialId: credentialID,
          publicKey: Buffer.from(credentialPublicKey),
          signCount: counter,
          aaguid,
          transports: (credential as { response?: { transports?: string[] } }).response?.transports ?? [],
          spcCapable,
        },
      })
      server.log.info({ acsTransId, credentialID, aaguid, authenticatorLabel }, '[register] passkey enrolled')

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
    server.log.info({ credentialId, storedIds: transaction.user.credentials.map(c => c.credentialId) }, 'credential lookup')
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

      server.log.info({ acsTransId, credentialId }, '[webauthn] authenticated')
      return { success: true }
    } catch (err) {
      server.log.error(err)
      return reply.code(401).send({ error: 'Authentication failed' })
    }
  })
}
