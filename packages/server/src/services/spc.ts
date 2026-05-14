import type { FastifyBaseLogger } from 'fastify'
import { createHash, randomBytes } from 'crypto'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types'
import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { claimChallenge, issueChallenge } from './challenge'
import { currencyAlphaFromNumeric, formatMoneyForSpc } from './money'
import { buildSpcDisplayData } from './spc-display'
import {
  base64urlDecodeToString,
  verifySpcPaymentClientData,
} from './spc-linking'

export enum SpcAuditEvent {
  OptionsIssued = 'OPTIONS_ISSUED',
  OptionsFailed = 'OPTIONS_FAILED',
  VerifySucceeded = 'VERIFY_SUCCEEDED',
  VerifyFailed = 'VERIFY_FAILED',
  FallbackToOtp = 'FALLBACK_TO_OTP',
}

export enum SpcFailureReason {
  TransactionNotFound = 'TRANSACTION_NOT_FOUND',
  NoCredentials = 'NO_CREDENTIALS',
  UnsupportedCurrency = 'UNSUPPORTED_CURRENCY',
  MoneyFormattingFailed = 'MONEY_FORMATTING_FAILED',
  ServerMisconfigured = 'SERVER_MISCONFIGURED',
  ChallengeNotFound = 'CHALLENGE_NOT_FOUND',
  CredentialNotFound = 'CREDENTIAL_NOT_FOUND',
  MissingClientData = 'MISSING_CLIENT_DATA',
  DynamicLinkingMismatch = 'DYNAMIC_LINKING_MISMATCH',
  AssertionVerificationFailed = 'ASSERTION_VERIFICATION_FAILED',
  UserVerificationMissing = 'USER_VERIFICATION_MISSING',
  ClientInsecureContext = 'CLIENT_INSECURE_CONTEXT',
  ClientSpcUnavailable = 'CLIENT_SPC_UNAVAILABLE',
  ClientSpcError = 'CLIENT_SPC_ERROR',
  ClientUnknown = 'CLIENT_UNKNOWN',
}

type ServiceResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      statusCode: number
      error: string
      reason: SpcFailureReason
      detail?: string
    }

interface SpcRuntimeConfig {
  rpId: string
  rpOrigin: string
  log: FastifyBaseLogger
}

export interface SpcOptionsResponse {
  challenge: string
  rpId: string
  payeeOrigin: string
  credentials: Array<{
    credentialId: string
    spcCapable: boolean
    transports: string[]
  }>
  merchantName: string | null
  instrument: {
    displayName: string
    icon: string
  }
  total: {
    currency: string
    value: string
  }
  amount: number
  currencyNumeric: string
}

interface AuditInput {
  acsTransId: string
  event: SpcAuditEvent
  failureReason?: SpcFailureReason
  detail?: string
  expectedPayment?: Record<string, unknown>
  receivedPayment?: Record<string, unknown>
  credentialId?: string
}

// SPC mandates an https payeeOrigin. In dev we run merchant on http://localhost,
// so we accept SPC_PAYEE_ORIGIN as an explicit override and otherwise coerce
// MERCHANT_URL with a warning. Production should always set SPC_PAYEE_ORIGIN.
export function resolvePayeeOrigin(log: Pick<FastifyBaseLogger, 'warn'>): string {
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

function hashCredentialId(credentialId: string): string {
  return createHash('sha256').update(credentialId).digest('hex')
}

function iconHash(icon: unknown): string | undefined {
  return typeof icon === 'string'
    ? createHash('sha256').update(icon).digest('hex')
    : undefined
}

function paymentForAudit(payment: Record<string, unknown> | undefined) {
  if (!payment) return undefined
  const instrument = payment.instrument as Record<string, unknown> | undefined
  return {
    rpId: payment.rpId,
    topOrigin: payment.topOrigin,
    payeeOrigin: payment.payeeOrigin,
    total: payment.total,
    instrument: instrument
      ? {
          displayName: instrument.displayName,
          iconSha256: iconHash(instrument.icon),
        }
      : undefined,
  }
}

function expectedPaymentForAudit(input: {
  rpId: string
  payeeOrigin: string
  value: string
  currencyAlpha: string
  instrumentDisplayName: string
  instrumentIcon: string
}) {
  return {
    rpId: input.rpId,
    payeeOrigin: input.payeeOrigin,
    total: {
      value: input.value,
      currency: input.currencyAlpha,
    },
    instrument: {
      displayName: input.instrumentDisplayName,
      iconSha256: iconHash(input.instrumentIcon),
    },
  }
}

function parsePaymentFromClientData(clientDataB64url: string | undefined) {
  if (!clientDataB64url) return undefined
  try {
    const parsed = JSON.parse(base64urlDecodeToString(clientDataB64url)) as {
      payment?: Record<string, unknown>
    }
    return parsed.payment
  } catch {
    return undefined
  }
}

function jsonForPrisma(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!value) return undefined
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function recordSpcAudit(log: FastifyBaseLogger, input: AuditInput) {
  try {
    await prisma.spcAuthenticationAudit.create({
      data: {
        acsTransId: input.acsTransId,
        event: input.event,
        failureReason: input.failureReason,
        detail: input.detail,
        expectedPayment: jsonForPrisma(input.expectedPayment),
        receivedPayment: jsonForPrisma(input.receivedPayment),
        credentialIdHash: input.credentialId
          ? hashCredentialId(input.credentialId)
          : undefined,
      },
    })
  } catch (err) {
    log.warn({ err, acsTransId: input.acsTransId }, '[spc] audit write failed')
  }
}

function failure(
  statusCode: number,
  error: string,
  reason: SpcFailureReason,
  detail?: string,
): ServiceResult<never> {
  return { ok: false, statusCode, error, reason, detail }
}

function normalizeClientFailureReason(reason: string | undefined): SpcFailureReason {
  switch (reason) {
    case 'spc_insecure_context':
      return SpcFailureReason.ClientInsecureContext
    case 'spc_unavailable':
      return SpcFailureReason.ClientSpcUnavailable
    case 'spc_error':
      return SpcFailureReason.ClientSpcError
    default:
      return SpcFailureReason.ClientUnknown
  }
}

export async function recordSpcFallbackToOtp({
  acsTransId,
  reason,
  previousAuthType,
  log,
}: {
  acsTransId: string
  reason?: string
  previousAuthType?: string
  log: FastifyBaseLogger
}) {
  await recordSpcAudit(log, {
    acsTransId,
    event: SpcAuditEvent.FallbackToOtp,
    failureReason: normalizeClientFailureReason(reason),
    detail: previousAuthType
      ? `${reason ?? 'unknown'}; previousAuthType=${previousAuthType}`
      : reason,
  })
}

export async function createSpcAuthenticationRequest({
  acsTransId,
  rpId,
  rpOrigin,
  log,
}: SpcRuntimeConfig & { acsTransId: string }): Promise<ServiceResult<SpcOptionsResponse>> {
  const transaction = await prisma.transaction.findUnique({
    where: { acsTransId },
    include: { user: { include: { credentials: true } } },
  })

  if (!transaction?.user) {
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.OptionsFailed,
      failureReason: SpcFailureReason.TransactionNotFound,
    })
    return failure(404, 'Transaction not found', SpcFailureReason.TransactionNotFound)
  }

  const spcCredentials = transaction.user.credentials
  if (spcCredentials.length === 0) {
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.OptionsFailed,
      failureReason: SpcFailureReason.NoCredentials,
    })
    return failure(400, 'No credentials found', SpcFailureReason.NoCredentials)
  }

  const currencyAlpha = currencyAlphaFromNumeric(transaction.purchaseCurrency)
  if (!currencyAlpha) {
    log.error(
      { currency: transaction.purchaseCurrency },
      '[spc] unsupported currency code; add it to ISO_4217_NUM_TO_ALPHA',
    )
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.OptionsFailed,
      failureReason: SpcFailureReason.UnsupportedCurrency,
      detail: transaction.purchaseCurrency,
    })
    return failure(500, 'Unsupported currency', SpcFailureReason.UnsupportedCurrency)
  }

  let totalValue: string
  try {
    totalValue = formatMoneyForSpc(transaction.purchaseAmount, currencyAlpha)
  } catch (err) {
    log.error({ err, currencyAlpha }, '[spc] money formatting failed')
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.OptionsFailed,
      failureReason: SpcFailureReason.MoneyFormattingFailed,
      detail: err instanceof Error ? err.message : String(err),
    })
    return failure(500, 'Money formatting failed', SpcFailureReason.MoneyFormattingFailed)
  }

  let payeeOrigin: string
  try {
    payeeOrigin = resolvePayeeOrigin(log)
  } catch (err) {
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.OptionsFailed,
      failureReason: SpcFailureReason.ServerMisconfigured,
      detail: err instanceof Error ? err.message : String(err),
    })
    return failure(500, 'SPC server misconfigured', SpcFailureReason.ServerMisconfigured)
  }

  const challenge = randomBytes(32).toString('base64url')
  const displayData = buildSpcDisplayData(transaction.merchantName)

  await issueChallenge({
    acsTransId,
    purpose: 'SPC_AUTHENTICATE',
    challenge,
    rpId,
    origin: rpOrigin,
  })

  const expectedPayment = expectedPaymentForAudit({
    rpId,
    payeeOrigin,
    value: totalValue,
    currencyAlpha,
    instrumentDisplayName: displayData.instrument.displayName,
    instrumentIcon: displayData.instrument.icon,
  })

  await recordSpcAudit(log, {
    acsTransId,
    event: SpcAuditEvent.OptionsIssued,
    expectedPayment,
  })

  log.info(
    {
      acsTransId,
      rpId,
      payeeOrigin,
      credentialCount: spcCredentials.length,
      aaguids: spcCredentials.map(c => c.aaguid),
    },
    '[spc] options issued',
  )

  return {
    ok: true,
    value: {
      challenge,
      rpId,
      payeeOrigin,
      credentials: spcCredentials.map(c => ({
        credentialId: c.credentialId,
        spcCapable: c.spcCapable,
        transports: c.transports,
      })),
      merchantName: transaction.merchantName,
      instrument: displayData.instrument,
      total: {
        currency: currencyAlpha,
        value: totalValue,
      },
      amount: transaction.purchaseAmount,
      currencyNumeric: transaction.purchaseCurrency,
    },
  }
}

export async function verifySpcAuthentication({
  acsTransId,
  assertion,
  rpId,
  rpOrigin,
  log,
}: SpcRuntimeConfig & {
  acsTransId: string
  assertion: Record<string, unknown>
}): Promise<ServiceResult<{ success: true }>> {
  const transaction = await prisma.transaction.findUnique({
    where: { acsTransId },
    include: { user: { include: { credentials: true } } },
  })

  if (!transaction?.user) {
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.VerifyFailed,
      failureReason: SpcFailureReason.TransactionNotFound,
    })
    return failure(404, 'Transaction not found', SpcFailureReason.TransactionNotFound)
  }

  const credentialId = (assertion as { id?: string }).id
  const clientDataB64url = (assertion as { response?: { clientDataJSON?: string } })
    .response?.clientDataJSON
  const receivedPayment = paymentForAudit(parsePaymentFromClientData(clientDataB64url))

  const challengeSession = await claimChallenge(acsTransId, 'SPC_AUTHENTICATE')
  if (!challengeSession) {
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.VerifyFailed,
      failureReason: SpcFailureReason.ChallengeNotFound,
      receivedPayment,
      credentialId,
    })
    return failure(400, 'No challenge found', SpcFailureReason.ChallengeNotFound)
  }

  const storedCred = transaction.user.credentials.find(c => c.credentialId === credentialId)
  if (!credentialId || !storedCred) {
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.VerifyFailed,
      failureReason: SpcFailureReason.CredentialNotFound,
      receivedPayment,
      credentialId,
    })
    return failure(400, 'Credential not found', SpcFailureReason.CredentialNotFound)
  }

  if (!clientDataB64url) {
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.VerifyFailed,
      failureReason: SpcFailureReason.MissingClientData,
      credentialId,
    })
    return failure(400, 'Missing clientDataJSON', SpcFailureReason.MissingClientData)
  }

  const currencyAlpha = currencyAlphaFromNumeric(transaction.purchaseCurrency)
  if (!currencyAlpha) {
    log.error(
      { currency: transaction.purchaseCurrency },
      '[spc] unsupported currency code; add it to ISO_4217_NUM_TO_ALPHA',
    )
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.VerifyFailed,
      failureReason: SpcFailureReason.UnsupportedCurrency,
      detail: transaction.purchaseCurrency,
      receivedPayment,
      credentialId,
    })
    return failure(500, 'Unsupported currency', SpcFailureReason.UnsupportedCurrency)
  }

  let expectedValue: string
  try {
    expectedValue = formatMoneyForSpc(transaction.purchaseAmount, currencyAlpha)
  } catch (err) {
    log.error({ err, currencyAlpha }, '[spc] money formatting failed during verify')
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.VerifyFailed,
      failureReason: SpcFailureReason.MoneyFormattingFailed,
      detail: err instanceof Error ? err.message : String(err),
      receivedPayment,
      credentialId,
    })
    return failure(500, 'Money formatting failed', SpcFailureReason.MoneyFormattingFailed)
  }

  let payeeOrigin: string
  try {
    payeeOrigin = resolvePayeeOrigin(log)
  } catch (err) {
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.VerifyFailed,
      failureReason: SpcFailureReason.ServerMisconfigured,
      detail: err instanceof Error ? err.message : String(err),
      receivedPayment,
      credentialId,
    })
    return failure(500, 'SPC server misconfigured', SpcFailureReason.ServerMisconfigured)
  }

  const displayData = buildSpcDisplayData(transaction.merchantName)
  const expectedPayment = expectedPaymentForAudit({
    rpId,
    payeeOrigin,
    value: expectedValue,
    currencyAlpha,
    instrumentDisplayName: displayData.instrument.displayName,
    instrumentIcon: displayData.instrument.icon,
  })

  const linking = verifySpcPaymentClientData(clientDataB64url, {
    rpId,
    payeeOrigin,
    value: expectedValue,
    currencyAlpha,
    instrumentDisplayName: displayData.instrument.displayName,
    instrumentIcon: displayData.instrument.icon,
  })
  if (!linking.ok) {
    log.warn({ acsTransId, reason: linking.reason }, '[spc] dynamic-linking mismatch')
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.VerifyFailed,
      failureReason: SpcFailureReason.DynamicLinkingMismatch,
      detail: linking.reason,
      expectedPayment,
      receivedPayment,
      credentialId,
    })
    return failure(
      401,
      'Dynamic linking mismatch',
      SpcFailureReason.DynamicLinkingMismatch,
      linking.reason,
    )
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: assertion as unknown as Parameters<
        typeof verifyAuthenticationResponse
      >[0]['response'],
      expectedChallenge: challengeSession.challenge,
      expectedOrigin: rpOrigin,
      expectedRPID: rpId,
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
      await recordSpcAudit(log, {
        acsTransId,
        event: SpcAuditEvent.VerifyFailed,
        failureReason: SpcFailureReason.AssertionVerificationFailed,
        expectedPayment,
        receivedPayment,
        credentialId,
      })
      return failure(401, 'SPC verification failed', SpcFailureReason.AssertionVerificationFailed)
    }

    if (!verification.authenticationInfo.userVerified) {
      log.error({ acsTransId }, '[spc] UV flag absent despite requireUserVerification')
      await recordSpcAudit(log, {
        acsTransId,
        event: SpcAuditEvent.VerifyFailed,
        failureReason: SpcFailureReason.UserVerificationMissing,
        expectedPayment,
        receivedPayment,
        credentialId,
      })
      return failure(401, 'User verification not performed', SpcFailureReason.UserVerificationMissing)
    }

    await prisma.webAuthnCredential.update({
      where: { credentialId: storedCred.credentialId },
      data: {
        signCount: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
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

    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.VerifySucceeded,
      expectedPayment,
      receivedPayment,
      credentialId,
    })

    log.info({ acsTransId, credentialId }, '[spc] authenticated')
    return { ok: true, value: { success: true } }
  } catch (err) {
    log.error(err)
    await recordSpcAudit(log, {
      acsTransId,
      event: SpcAuditEvent.VerifyFailed,
      failureReason: SpcFailureReason.AssertionVerificationFailed,
      detail: err instanceof Error ? err.message : String(err),
      expectedPayment,
      receivedPayment,
      credentialId,
    })
    return failure(401, 'SPC verification failed', SpcFailureReason.AssertionVerificationFailed)
  }
}
