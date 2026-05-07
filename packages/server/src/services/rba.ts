import { prisma } from '../prisma'

interface RBAInput {
  cardNumberHash: string
  merchantId: string
  purchaseAmount: number
  deviceHash: string
  ipAddress: string
}

interface RBAResult {
  decision: 'frictionless' | 'challenge'
  reason: string
  deviceKnown: boolean
  // 'otp'    : 常にOTP（Passkey登録済みでも）
  // 'passkey': 常にPasskey
  // 'auto'   : Passkey登録済みならPasskey、なければOTP
  authTypeHint: 'otp' | 'passkey' | 'auto'
}

const FORCED_FRICTIONLESS = new Set([
  '9bbef19476623ca56c17da75fd57734dbf82530686043a6e491c6d71befe8f6e', // 4111111111111111
])

// 常にOTPチャレンジにするカード（Passkey登録済みでも）
const FORCED_OTP = new Set([
  'd22c0b383ff28ab45e15694f4b949b2a598ec8a18400c3dab33f1f2e02be0ed0', // 4111111111111129
])

// 常にPasskeyチャレンジにするカード
const FORCED_PASSKEY = new Set([
  'f6b7d87fe55b76e653b556afcbbf0e868d808ac9a375338469ca45187a4dc4d8', // 4111111111111137
])

export async function evaluateRBA(input: RBAInput): Promise<RBAResult> {
  if (FORCED_FRICTIONLESS.has(input.cardNumberHash)) {
    return { decision: 'frictionless', reason: 'forced_frictionless', deviceKnown: true, authTypeHint: 'auto' }
  }

  if (FORCED_OTP.has(input.cardNumberHash)) {
    return { decision: 'challenge', reason: 'forced_otp', deviceKnown: false, authTypeHint: 'otp' }
  }

  if (FORCED_PASSKEY.has(input.cardNumberHash)) {
    return { decision: 'challenge', reason: 'forced_passkey', deviceKnown: false, authTypeHint: 'passkey' }
  }

  if (input.purchaseAmount >= 30000) {
    return { decision: 'challenge', reason: 'high_amount', deviceKnown: false, authTypeHint: 'auto' }
  }

  const user = await prisma.user.findUnique({
    where: { cardNumberHash: input.cardNumberHash },
    include: { devices: true, transactions: true },
  })

  if (!user) {
    return { decision: 'challenge', reason: 'unknown_user', deviceKnown: false, authTypeHint: 'auto' }
  }

  const deviceKnown = user.devices.some(d => d.deviceHash === input.deviceHash)
  if (!deviceKnown) {
    return { decision: 'challenge', reason: 'unknown_device', deviceKnown: false, authTypeHint: 'auto' }
  }

  const merchantKnown = user.transactions.some(t => t.merchantId === input.merchantId)
  if (!merchantKnown) {
    return { decision: 'challenge', reason: 'new_merchant', deviceKnown: true, authTypeHint: 'auto' }
  }

  return { decision: 'frictionless', reason: 'trusted', deviceKnown: true, authTypeHint: 'auto' }
}

export async function updateDeviceHistory(userId: string, deviceHash: string): Promise<void> {
  await prisma.deviceFingerprint.upsert({
    where: { userId_deviceHash: { userId, deviceHash } },
    update: { lastSeenAt: new Date(), transactionCount: { increment: 1 } },
    create: { userId, deviceHash },
  })
}
