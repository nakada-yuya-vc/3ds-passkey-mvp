import { prisma } from '../prisma'

export type ChallengePurpose =
  | 'WEBAUTHN_REGISTER'
  | 'WEBAUTHN_AUTHENTICATE'
  | 'SPC_AUTHENTICATE'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

export async function issueChallenge({
  acsTransId,
  purpose,
  challenge,
  rpId,
  origin,
  credentialId,
}: {
  acsTransId: string
  purpose: ChallengePurpose
  challenge: string
  rpId: string
  origin?: string
  credentialId?: string
}) {
  const now = new Date()

  return prisma.$transaction(async tx => {
    await tx.challengeSession.updateMany({
      where: { acsTransId, purpose, consumedAt: null },
      data: { consumedAt: now },
    })

    return tx.challengeSession.create({
      data: {
        acsTransId,
        purpose,
        challenge,
        rpId,
        origin,
        credentialId,
        expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
      },
    })
  })
}

export async function findActiveChallenge(
  acsTransId: string,
  purpose: ChallengePurpose
) {
  return prisma.challengeSession.findFirst({
    where: {
      acsTransId,
      purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function consumeChallenge(id: string) {
  await prisma.challengeSession.update({
    where: { id },
    data: { consumedAt: new Date() },
  })
}

// Atomically pick the most-recent active challenge AND mark it consumed.
// Returns the claimed challenge, or null if none was claimable.
// Used by verify endpoints so a failed verification still burns the challenge,
// preventing replay of the same challenge against a second verify attempt.
export async function claimChallenge(
  acsTransId: string,
  purpose: ChallengePurpose
) {
  const now = new Date()
  return prisma.$transaction(async tx => {
    const session = await tx.challengeSession.findFirst({
      where: {
        acsTransId,
        purpose,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!session) return null
    const claimed = await tx.challengeSession.updateMany({
      where: { id: session.id, consumedAt: null },
      data: { consumedAt: now },
    })
    if (claimed.count === 0) return null
    return session
  })
}
