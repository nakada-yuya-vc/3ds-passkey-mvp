import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '../prisma'
import { updateDeviceHistory } from '../services/rba'
import { generateOtp, verifyOtp } from '../services/otp'
import { recordSpcFallbackToOtp } from '../services/spc'
import {
  AcsTransactionState,
  initialAcsStateForAuthType,
  recordInitialAcsState,
  transitionAcsState,
} from '../services/acs-state'

type AuthFlow = 'frictionless' | 'otp' | 'webauthn' | 'spc'

export async function threedsRoutes(server: FastifyInstance) {
  // POST /threeds/areq
  server.post<{
    Body: {
      threeDSServerTransID: string
      cardNumber: string
      merchantID: string
      merchantName: string
      purchaseAmount: number
      purchaseCurrency: string
      deviceChannel: string
      authFlow?: AuthFlow
      browserInfo: {
        userAgent: string
        language: string
        screenWidth: number
        screenHeight: number
      }
    }
  }>('/areq', async (request, reply) => {
    const { createHmac } = await import('crypto')
    const {
      threeDSServerTransID,
      cardNumber,
      merchantID,
      merchantName,
      purchaseAmount,
      purchaseCurrency,
      browserInfo,
      authFlow = 'webauthn',
    } = request.body

    // PAN space is small enough (BIN + Luhn ≪ 10^10) to brute-force a plain SHA-256.
    // Use HMAC with a server-side pepper so the join key isn't reversible from a DB leak.
    // In production the pepper should be backed by KMS / Secrets Manager — never the env.
    const pepper = process.env.PAN_PEPPER
    if (!pepper || pepper.length < 32) {
      server.log.error('[areq] PAN_PEPPER unset or too short (>=32 chars required)')
      return reply.code(500).send({ error: 'Server misconfigured: PAN_PEPPER' })
    }
    const cardNumberHash = createHmac('sha256', pepper).update(cardNumber).digest('hex')
    const ipAddress = request.ip || '127.0.0.1'
    const deviceHash = Buffer.from(
      `${browserInfo.userAgent}|${browserInfo.screenWidth}x${browserInfo.screenHeight}`
    ).toString('base64').slice(0, 32)

    // ユーザー取得または作成
    let user = await prisma.user.findUnique({ where: { cardNumberHash } })
    if (!user) {
      user = await prisma.user.create({ data: { cardNumberHash } })
    }

    // デバイス履歴を更新（メトリクス用）
    await updateDeviceHistory(user.id, deviceHash)

    // パスキー登録済みか確認
    const hasPasskey = await prisma.webAuthnCredential.findFirst({
      where: { userId: user.id },
    })

    // authFlow から authType を決定
    let authType: 'FRICTIONLESS' | 'OTP' | 'PASSKEY' | 'PASSKEY_SPC'
    if (authFlow === 'frictionless') {
      authType = 'FRICTIONLESS'
    } else if (authFlow === 'otp') {
      authType = 'OTP'
    } else if (authFlow === 'webauthn') {
      authType = hasPasskey ? 'PASSKEY' : 'OTP'
    } else {
      // spc: SPC capability はクライアント側の canMakePayment() で判定するため、
      // パスキーがあれば PASSKEY_SPC としてクライアントに委ねる
      authType = hasPasskey ? 'PASSKEY_SPC' : 'OTP'
    }

    const isFreictionless = authType === 'FRICTIONLESS'
    const acsTransId = uuidv4()
    const acsState = initialAcsStateForAuthType(authType)

    await prisma.transaction.create({
      data: {
        threeDSServerTransId: threeDSServerTransID,
        acsTransId,
        userId: user.id,
        cardNumberHash,
        merchantId: merchantID,
        merchantName,
        purchaseAmount,
        purchaseCurrency: purchaseCurrency || '392',
        authType,
        authResult: 'ATTEMPTED',
        frictionless: isFreictionless,
        acsState,
        deviceKnown: true,
        deviceHash,
        ipAddress,
        challengeStartedAt: isFreictionless ? null : new Date(),
        authenticatedAt: isFreictionless ? new Date() : null,
      },
    })
    await recordInitialAcsState({
      acsTransId,
      toState: acsState,
      reason: `authFlow=${authFlow}; authType=${authType}`,
    })

    server.log.info(
      { acsTransId, authFlow, authType, hasPasskey: !!hasPasskey, userId: user.id },
      '[areq] auth flow decided'
    )

    if (isFreictionless) {
      await prisma.transaction.update({
        where: { acsTransId },
        data: { authResult: 'AUTHENTICATED' },
      })
      server.log.info({ acsTransId, authType: 'FRICTIONLESS' }, '[areq] frictionless authenticated')
      return { acsTransID: acsTransId, transStatus: 'Y', frictionless: true }
    }

    if (authType === 'OTP') {
      await generateOtp(acsTransId)
    }

    return {
      acsTransID: acsTransId,
      transStatus: 'C',
      authType,
      hasPasskey: !!hasPasskey,
    }
  })

  // POST /threeds/fallback/otp - SPC 失敗時に OTP へフォールバック
  server.post<{
    Body: {
      acsTransID: string
      reason?: string
    }
  }>('/fallback/otp', async (request, reply) => {
    const { acsTransID, reason } = request.body

    const transaction = await prisma.transaction.findUnique({
      where: { acsTransId: acsTransID },
    })

    if (!transaction) {
      return reply.code(404).send({ error: 'Transaction not found' })
    }

    if (transaction.authResult === 'AUTHENTICATED') {
      return reply.code(409).send({ error: 'Transaction already authenticated' })
    }

    await generateOtp(acsTransID)
    await prisma.transaction.update({
      where: { acsTransId: acsTransID },
      data: {
        authType: 'OTP',
        authResult: 'ATTEMPTED',
        acsState: AcsTransactionState.OTP_FALLBACK_REQUIRED,
        challengeStartedAt: transaction.challengeStartedAt ?? new Date(),
      },
    })
    await transitionAcsState({
      acsTransId: acsTransID,
      fromState: transaction.acsState,
      toState: AcsTransactionState.OTP_FALLBACK_REQUIRED,
      reason: reason ?? 'fallback_to_otp',
    })
    await recordSpcFallbackToOtp({
      acsTransId: acsTransID,
      reason,
      previousAuthType: transaction.authType,
      log: server.log,
    })

    server.log.info({ acsTransID, previousAuthType: transaction.authType, reason }, '[fallback] OTP issued')
    return { status: 'otp_required' }
  })

  // POST /threeds/creq - OTP検証
  server.post<{
    Body: {
      acsTransID: string
      otpCode?: string
    }
  }>('/creq', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { acsTransID, otpCode } = request.body

    const transaction = await prisma.transaction.findUnique({
      where: { acsTransId: acsTransID },
      include: { user: true },
    })

    if (!transaction) {
      return reply.code(404).send({ error: 'Transaction not found' })
    }

    if (!otpCode) {
      return reply.code(400).send({ error: 'OTP code required' })
    }

    const valid = await verifyOtp(acsTransID, otpCode)
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid or expired OTP' })
    }

    await prisma.transaction.update({
      where: { acsTransId: acsTransID },
      data: {
        authResult: 'AUTHENTICATED',
        acsState: AcsTransactionState.OTP_AUTHENTICATED,
        otpCompletedAt: new Date(),
        authenticatedAt: new Date(),
      },
    })
    await transitionAcsState({
      acsTransId: acsTransID,
      fromState: transaction.acsState,
      toState: AcsTransactionState.OTP_AUTHENTICATED,
      reason: 'otp_verified',
    })

    server.log.info({ acsTransID }, '[creq] OTP verified')
    return { status: 'show_enroll' }
  })

  // GET /threeds/transaction/:acsTransId - トランザクション情報取得
  server.get<{ Params: { acsTransId: string } }>(
    '/transaction/:acsTransId',
    async (request, reply) => {
      const { acsTransId } = request.params

      const transaction = await prisma.transaction.findUnique({
        where: { acsTransId },
        include: {
          user: {
            include: { credentials: true },
          },
        },
      })

      if (!transaction) {
        return reply.code(404).send({ error: 'Not found' })
      }

      return {
        acsTransId: transaction.acsTransId,
        authType: transaction.authType,
        merchantName: transaction.merchantName,
        purchaseAmount: transaction.purchaseAmount,
        acsState: transaction.acsState,
        hasPasskey: (transaction.user?.credentials.length ?? 0) > 0,
        credentials: transaction.user?.credentials.map(c => ({
          credentialId: c.credentialId,
          spcCapable: c.spcCapable,
          transports: c.transports,
        })) ?? [],
      }
    }
  )

  // POST /threeds/complete - 認証完了通知
  server.post<{
    Body: { acsTransID: string; result: 'AUTHENTICATED' | 'NOT_AUTHENTICATED' }
  }>('/complete', async (request, reply) => {
    const { acsTransID, result } = request.body
    const transaction = await prisma.transaction.findUnique({
      where: { acsTransId: acsTransID },
    })

    if (!transaction) {
      return reply.code(404).send({ error: 'Transaction not found' })
    }

    const nextState = result === 'AUTHENTICATED'
      ? AcsTransactionState.OTP_AUTHENTICATED
      : AcsTransactionState.AUTHENTICATION_FAILED

    await prisma.transaction.update({
      where: { acsTransId: acsTransID },
      data: {
        authResult: result,
        acsState: nextState,
        authenticatedAt: result === 'AUTHENTICATED' ? new Date() : undefined,
      },
    })
    await transitionAcsState({
      acsTransId: acsTransID,
      fromState: transaction.acsState,
      toState: nextState,
      reason: `challenge_complete_${result.toLowerCase()}`,
    })

    return { success: true }
  })
}
