import { AcsTransactionState } from '@prisma/client'
import { prisma } from '../prisma'

export { AcsTransactionState }

export function initialAcsStateForAuthType(authType: string): AcsTransactionState {
  return authType === 'FRICTIONLESS'
    ? AcsTransactionState.FRICTIONLESS_AUTHENTICATED
    : AcsTransactionState.CHALLENGE_REQUIRED
}

export async function recordInitialAcsState({
  acsTransId,
  toState,
  reason,
}: {
  acsTransId: string
  toState: AcsTransactionState
  reason?: string
}) {
  await prisma.acsTransactionStateHistory.create({
    data: {
      acsTransId,
      fromState: AcsTransactionState.A_REQ_RECEIVED,
      toState,
      reason,
    },
  })
}

export async function transitionAcsState({
  acsTransId,
  fromState,
  toState,
  reason,
}: {
  acsTransId: string
  fromState?: AcsTransactionState | null
  toState: AcsTransactionState
  reason?: string
}) {
  await prisma.transaction.update({
    where: { acsTransId },
    data: { acsState: toState },
  })
  await prisma.acsTransactionStateHistory.create({
    data: {
      acsTransId,
      fromState,
      toState,
      reason,
    },
  })
}
