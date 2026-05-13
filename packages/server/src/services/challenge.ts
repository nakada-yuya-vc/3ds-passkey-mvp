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
