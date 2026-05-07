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
}

const FORCED_FRICTIONLESS = new Set([
  '9bbef19476623ca56c17da75fd57734dbf82530686043a6e491c6d71befe8f6e', // 4111111111111111
])

const FORCED_CHALLENGE = new Set([
  'd22c0b383ff28ab45e15694f4b949b2a598ec8a18400c3dab33f1f2e02be0ed0', // 4111111111111129
  'f6b7d87fe55b76e653b556afcbbf0e868d808ac9a375338469ca45187a4dc4d8', // 4111111111111137
])

export async function evaluateRBA(input: RBAInput): Promise<RBAResult> {
  if (FORCED_FRICTIONLESS.has(input.cardNumberHash)) {
    return { decision: 'frictionless', reason: 'forced_frictionless', deviceKnown: true }
  }

  if (FORCED_CHALLENGE.has(input.cardNumberHash)) {
    return { decision: 'challenge', reason: 'forced_challenge', deviceKnown: false }
  }

  if (input.purchaseAmount >= 30000) {
    return { decision: 'challenge', reason: 'high_amount', deviceKnown: false }
  }

  const user = await prisma.user.findUnique({
    where: { cardNumberHash: input.cardNumberHash },
    include: { devices: true, transactions: true },
  })

  if (!user) {
    return { decision: 'challenge', reason: 'unknown_user', deviceKnown: false }
  }

  const deviceKnown = user.devices.some(d => d.deviceHash === input.deviceHash)
  if (!deviceKnown) {
    return { decision: 'challenge', reason: 'unknown_device', deviceKnown: false }
  }

  const merchantKnown = user.transactions.some(t => t.merchantId === input.merchantId)
  if (!merchantKnown) {
    return { decision: 'challenge', reason: 'new_merchant', deviceKnown: true }
  }

  return { decision: 'frictionless', reason: 'trusted', deviceKnown: true }
}

export async function updateDeviceHistory(userId: string, deviceHash: string): Promise<void> {
  await prisma.deviceFingerprint.upsert({
    where: { userId_deviceHash: { userId, deviceHash } },
    update: { lastSeenAt: new Date(), transactionCount: { increment: 1 } },
    create: { userId, deviceHash },
  })
}
