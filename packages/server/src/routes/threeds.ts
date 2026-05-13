import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '../prisma'
import { updateDeviceHistory } from '../services/rba'
import { generateOtp, verifyOtp } from '../services/otp'

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
    const { createHash } = await import('crypto')
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

    const cardNumberHash = createHash('sha256').update(cardNumber).digest('hex')
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
        deviceKnown: true,
        deviceHash,
        ipAddress,
        challengeStartedAt: isFreictionless ? null : new Date(),
        authenticatedAt: isFreictionless ? new Date() : null,
      },
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

  // POST /threeds/creq - OTP検証
  server.post<{
    Body: {
      acsTransID: string
      otpCode?: string
    }
  }>('/creq', async (request, reply) => {
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
      data: { otpCompletedAt: new Date() },
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

    await prisma.transaction.update({
      where: { acsTransId: acsTransID },
      data: {
        authResult: result,
        authenticatedAt: result === 'AUTHENTICATED' ? new Date() : undefined,
      },
    })

    return { success: true }
  })
}
