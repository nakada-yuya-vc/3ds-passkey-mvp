import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '../prisma'
import { evaluateRBA, updateDeviceHistory } from '../services/rba'
import { generateOtp, verifyOtp } from '../services/otp'

// テスト用カード番号→ハッシュマッピング（固定値）
const TEST_CARD_HASHES: Record<string, string> = {
  '4111111111111111': 'a0e0f5a2a3e4f6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1',
  '4111111111111129': 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2',
  '4111111111111137': 'c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
  '4111111111111145': 'd3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4',
}

export async function threedsRoutes(server: FastifyInstance) {
  // POST /threeds/areq
  server.post<{
    Body: {
      threeDSServerTransID: string
      cardNumberHash: string
      merchantID: string
      merchantName: string
      purchaseAmount: number
      purchaseCurrency: string
      deviceChannel: string
      browserInfo: {
        userAgent: string
        language: string
        screenWidth: number
        screenHeight: number
      }
    }
  }>('/areq', async (request, reply) => {
    const {
      threeDSServerTransID,
      cardNumberHash,
      merchantID,
      merchantName,
      purchaseAmount,
      purchaseCurrency,
      browserInfo,
    } = request.body

    const ipAddress = request.ip || '127.0.0.1'
    const deviceHash = Buffer.from(
      `${browserInfo.userAgent}|${browserInfo.screenWidth}x${browserInfo.screenHeight}`
    ).toString('base64').slice(0, 32)

    const rbaResult = await evaluateRBA({
      cardNumberHash,
      merchantId: merchantID,
      purchaseAmount,
      deviceHash,
      ipAddress,
    })

    // ユーザー取得または作成
    let user = await prisma.user.findUnique({ where: { cardNumberHash } })
    if (!user) {
      user = await prisma.user.create({ data: { cardNumberHash } })
    }

    if (rbaResult.deviceKnown) {
      await updateDeviceHistory(user.id, deviceHash)
    }

    const acsTransId = uuidv4()
    const isFreictionless = rbaResult.decision === 'frictionless'

    // Passkey 登録済みか確認
    const hasPasskey = await prisma.webAuthnCredential.findFirst({
      where: { userId: user.id },
    })

    let authType: 'FRICTIONLESS' | 'OTP' | 'PASSKEY' | 'PASSKEY_SPC' = 'FRICTIONLESS'
    if (!isFreictionless) {
      authType = hasPasskey ? 'PASSKEY' : 'OTP'
    }

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
        deviceKnown: rbaResult.deviceKnown,
        deviceHash,
        ipAddress,
        challengeStartedAt: isFreictionless ? null : new Date(),
        authenticatedAt: isFreictionless ? new Date() : null,
      },
    })

    if (isFreictionless) {
      await prisma.transaction.update({
        where: { acsTransId },
        data: { authResult: 'AUTHENTICATED' },
      })

      if (rbaResult.deviceKnown) {
        await updateDeviceHistory(user.id, deviceHash)
      } else {
        await prisma.deviceFingerprint.create({
          data: { userId: user.id, deviceHash },
        }).catch(() => {})
      }

      return { acsTransID: acsTransId, transStatus: 'Y', frictionless: true }
    }

    // チャレンジが必要な場合: OTP生成
    if (authType === 'OTP') {
      await generateOtp(acsTransId)
    }

    const acsURL = `${process.env.ACS_URL || 'http://localhost:3001'}/challenge/${acsTransId}`

    return {
      acsTransID: acsTransId,
      transStatus: 'C',
      acsURL,
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

    // OTP検証成功時刻を記録（メトリクス計算用）
    await prisma.transaction.update({
      where: { acsTransId: acsTransID },
      data: { otpCompletedAt: new Date() },
    })

    // OTP検証成功 → クライアントが /webauthn/register/options を呼んでオプション取得する
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
