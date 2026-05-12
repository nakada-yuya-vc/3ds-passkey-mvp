import { prisma } from '../prisma'

export async function updateDeviceHistory(userId: string, deviceHash: string): Promise<void> {
  await prisma.deviceFingerprint.upsert({
    where: { userId_deviceHash: { userId, deviceHash } },
    update: { lastSeenAt: new Date(), transactionCount: { increment: 1 } },
    create: { userId, deviceHash },
  })
}
