import { FastifyInstance } from 'fastify'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types'
import { prisma } from '../prisma'
import { claimChallenge, issueChallenge } from '../services/challenge'
import { currencyAlphaFromNumeric, formatMoneyForSpc } from '../services/money'
import { verifySpcPaymentClientData } from '../services/spc-linking'

// SPC mandates an https payeeOrigin. In dev we run merchant on http://localhost,
// so we accept SPC_PAYEE_ORIGIN as an explicit override (must be https) and
// otherwise fall back to coercing MERCHANT_URL — emitting a warning so the dev
// hack is never silently shipped to prod.
function resolvePayeeOrigin(log: { warn: (msg: string) => void }): string {
  const explicit = process.env.SPC_PAYEE_ORIGIN
  if (explicit) {
    if (!explicit.startsWith('https://')) {
      throw new Error(`SPC_PAYEE_ORIGIN must start with https:// (got ${explicit})`)
    }
    return explicit
  }
  const merchantOrigin =
    process.env.MERCHANT_ORIGIN || process.env.MERCHANT_URL || 'http://localhost:3002'
  if (merchantOrigin.startsWith('https://')) return merchantOrigin
  const coerced = merchantOrigin.replace(/^http:\/\//, 'https://')
  log.warn(
    `[spc] payeeOrigin coerced ${merchantOrigin} -> ${coerced}. Set SPC_PAYEE_ORIGIN explicitly in non-dev environments.`,
  )
  return coerced
}

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

      const currencyAlpha = currencyAlphaFromNumeric(transaction.purchaseCurrency)
      if (!currencyAlpha) {
        server.log.error(
          { currency: transaction.purchaseCurrency },
          '[spc] unsupported currency code — add it to ISO_4217_NUM_TO_ALPHA',
        )
        return reply.code(500).send({ error: 'Unsupported currency' })
      }
      let totalValue: string
      try {
        totalValue = formatMoneyForSpc(transaction.purchaseAmount, currencyAlpha)
      } catch (err) {
        server.log.error({ err, currencyAlpha }, '[spc] money formatting failed')
        return reply.code(500).send({ error: 'Money formatting failed' })
      }

      const { randomBytes } = await import('crypto')
      const challenge = randomBytes(32).toString('base64url')

      const payeeOrigin = resolvePayeeOrigin(server.log)

      await issueChallenge({
        acsTransId,
        purpose: 'SPC_AUTHENTICATE',
        challenge,
        rpId: rpID,
        origin: rpOrigin,
      })

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
        // `total` is shaped exactly like W3C PaymentCurrencyAmount and is pre-formatted
        // for the currency's minor-unit exponent. Clients should pass it straight into
        // `new PaymentRequest(...).total.amount`; never re-format on the client.
        total: {
          currency: currencyAlpha,
          value: totalValue,
        },
        // Kept for display (e.g. the iframe header). Display rendering is currency-aware
        // on the client side; SPC must use `total` above.
        amount: transaction.purchaseAmount,
        currencyNumeric: transaction.purchaseCurrency,
      }
    }
  )

  // POST /spc/verify
  server.post<{
    Body: {
      acsTransId: string
      assertion: Record<string, unknown>
    }
  }>('/verify', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { acsTransId, assertion } = request.body

    const transaction = await prisma.transaction.findUnique({
      where: { acsTransId },
      include: { user: { include: { credentials: true } } },
    })

    if (!transaction?.user) {
      return reply.code(404).send({ error: 'Transaction not found' })
    }

    // Claim atomically: burn the challenge even if downstream checks fail,
    // so a leaked challenge can't be reused against a second verify call.
    const challengeSession = await claimChallenge(acsTransId, 'SPC_AUTHENTICATE')
    if (!challengeSession) {
      return reply.code(400).send({ error: 'No challenge found' })
    }

    const credentialId = (assertion as { id?: string }).id
    const storedCred = transaction.user.credentials.find(
      c => c.credentialId === credentialId
    )

    if (!storedCred) {
      return reply.code(400).send({ error: 'Credential not found' })
    }

    // A-1: dynamic linking. Compare what the SPC UI signed (clientDataJSON.payment)
    // against the transaction the server actually issued. Without this the SPC
    // signature only proves "some payment dialog was confirmed" — not "THIS amount
    // to THIS payee was confirmed", which is the whole PSD2 SCA / EMVCo 3DS bind.
    const clientDataB64url = (assertion as { response?: { clientDataJSON?: string } })
      .response?.clientDataJSON
    if (!clientDataB64url) {
      return reply.code(400).send({ error: 'Missing clientDataJSON' })
    }

    const currencyAlpha = currencyAlphaFromNumeric(transaction.purchaseCurrency)
    if (!currencyAlpha) {
      server.log.error(
        { currency: transaction.purchaseCurrency },
        '[spc] unsupported currency code — add it to ISO_4217_NUM_TO_ALPHA',
      )
      return reply.code(500).send({ error: 'Unsupported currency' })
    }
    let expectedValue: string
    try {
      expectedValue = formatMoneyForSpc(transaction.purchaseAmount, currencyAlpha)
    } catch (err) {
      server.log.error({ err, currencyAlpha }, '[spc] money formatting failed during verify')
      return reply.code(500).send({ error: 'Money formatting failed' })
    }

    const linking = verifySpcPaymentClientData(clientDataB64url, {
      rpId: rpID,
      payeeOrigin: resolvePayeeOrigin(server.log),
      value: expectedValue,
      currencyAlpha,
    })
    if (!linking.ok) {
      server.log.warn(
        { acsTransId, reason: linking.reason },
        '[spc] dynamic-linking mismatch',
      )
      return reply.code(401).send({ error: 'Dynamic linking mismatch', reason: linking.reason })
    }

    try {
      // SPC assertions set clientDataJSON.type to "payment.get" (not "webauthn.get").
      // @simplewebauthn/server rejects unknown types by default, so explicitly allow it.
      // Signature/challenge/RPID verification otherwise follows the standard WebAuthn rules.
      const verification = await verifyAuthenticationResponse({
        response: assertion as unknown as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
        expectedChallenge: challengeSession.challenge,
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

      // Defense in depth: re-assert that the User Verification flag was set in authData.
      // SimpleWebAuthn already enforces this when requireUserVerification:true is passed,
      // but the PSD2 SCA "inherence" claim is load-bearing enough that we shouldn't rely
      // on a transitive library guarantee. If this ever fires, the library regressed.
      if (!verification.authenticationInfo.userVerified) {
        server.log.error({ acsTransId }, '[spc] UV flag absent despite requireUserVerification')
        return reply.code(401).send({ error: 'User verification not performed' })
      }

      await prisma.webAuthnCredential.update({
        where: { credentialId: storedCred.credentialId },
        data: {
          signCount: verification.authenticationInfo.newCounter,
          lastUsedAt: new Date(),
          // First successful SPC ceremony confirms the authenticator actually supports SPC
          // (the third-party payment bit was retained). Flip the field to reflect reality.
          spcCapable: true,
        },
      })

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
