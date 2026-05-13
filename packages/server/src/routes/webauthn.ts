import { FastifyInstance } from 'fastify'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types'
import { prisma } from '../prisma'
import { claimChallenge, issueChallenge } from '../services/challenge'

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
        // Request a direct attestation statement so we can record the authenticator's
        // claimed make/model (fmt + AAGUID) for audit. Acceptance does NOT currently
        // depend on the attestation chain — that is a policy decision (which roots /
        // AAGUIDs to trust) tracked in BACKLOG. SimpleWebAuthn still cryptographically
        // verifies the statement format on the verify side; we just capture the result.
        // Most platform authenticators (Windows Hello, Touch ID) return this without a
        // user prompt; iCloud Keychain returns an anonymous "apple" attestation with a
        // zeroed AAGUID, which is by design and is recorded as-is.
        attestationType: 'direct',
        // Per W3C SPC spec / Chrome / MDN, the property is `isPayment: true`.
        // (An earlier draft of the spec used `isPaymentCredential`; Chrome silently ignores
        // the unknown key, so the credential is created without the SPC marker and any later
        // SPC ceremony fails with NotAllowedError at show() time.)
        // https://developer.mozilla.org/en-US/docs/Web/API/Payment_Request_API/Using_secure_payment_confirmation
        extensions: {
          payment: { isPayment: true },
        } as Record<string, unknown>,
      })

      await issueChallenge({
        acsTransId,
        purpose: 'WEBAUTHN_REGISTER',
        challenge: options.challenge,
        rpId: rpID,
        origin: rpOrigin,
      })

      return options
    }
  )

  // POST /webauthn/register/verify
  server.post<{
    Body: {
      acsTransId: string
      credential: Record<string, unknown>
    }
  }>('/register/verify', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { acsTransId, credential } = request.body

    const transaction = await prisma.transaction.findUnique({
      where: { acsTransId },
      include: { user: true },
    })

    if (!transaction?.user) {
      return reply.code(404).send({ error: 'Transaction not found' })
    }

    // Claim atomically: burn the challenge even if verification later fails,
    // so the same challenge can't be replayed against a second verify attempt.
    const challengeSession = await claimChallenge(acsTransId, 'WEBAUTHN_REGISTER')
    if (!challengeSession) {
      return reply.code(400).send({ error: 'No challenge found' })
    }

    try {
      const verification = await verifyRegistrationResponse({
        response: credential as unknown as Parameters<typeof verifyRegistrationResponse>[0]['response'],
        expectedChallenge: challengeSession.challenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
        requireUserVerification: true,
      })

      if (!verification.verified || !verification.registrationInfo) {
        return reply.code(400).send({ error: 'Verification failed' })
      }

      const { credentialID, credentialPublicKey, counter, fmt } = verification.registrationInfo

      // The SPC payment extension has no registration-time client output (W3C SPC issue #273),
      // so at registration we can't actually prove the authenticator persisted the third-party
      // payment bit. Start `spcCapable = false` and flip it to true only after the first
      // successful SPC ceremony on this credential — i.e. real observed behaviour, not a claim.
      // (A complementary AAGUID allowlist for known-good authenticators is tracked in BACKLOG.)
      const spcCapable = false
      const aaguid = verification.registrationInfo.aaguid
      const attestationFormat = fmt ?? null
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
        { credentialID, aaguid, authenticatorLabel, attestationFormat, spcCapable },
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
          attestationFormat,
        },
      })
      server.log.info(
        { acsTransId, credentialID, aaguid, authenticatorLabel, attestationFormat },
        '[register] passkey enrolled',
      )

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

      await issueChallenge({
        acsTransId,
        purpose: 'WEBAUTHN_AUTHENTICATE',
        challenge: options.challenge,
        rpId: rpID,
        origin: rpOrigin,
      })

      return options
    }
  )

  // POST /webauthn/authenticate/verify
  server.post<{
    Body: {
      acsTransId: string
      credential: Record<string, unknown>
    }
  }>('/authenticate/verify', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { acsTransId, credential } = request.body

    const transaction = await prisma.transaction.findUnique({
      where: { acsTransId },
      include: { user: { include: { credentials: true } } },
    })

    if (!transaction?.user) {
      return reply.code(404).send({ error: 'Transaction not found' })
    }

    const challengeSession = await claimChallenge(acsTransId, 'WEBAUTHN_AUTHENTICATE')
    if (!challengeSession) {
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
        expectedChallenge: challengeSession.challenge,
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

      // Defense in depth — see comment in spc.ts. If UV is missing we cannot claim SCA inherence.
      if (!verification.authenticationInfo.userVerified) {
        server.log.error({ acsTransId }, '[webauthn] UV flag absent despite requireUserVerification')
        return reply.code(401).send({ error: 'User verification not performed' })
      }

      await prisma.webAuthnCredential.update({
        where: { credentialId: storedCred.credentialId },
        data: {
          signCount: verification.authenticationInfo.newCounter,
          lastUsedAt: new Date(),
        },
      })

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
