// Verifies the W3C Secure Payment Confirmation dynamic-linking invariants —
// i.e. that the `payment` member of the signed clientDataJSON describes the
// same transaction (rpId, payeeOrigin, total, and instrument identity) that the
// server originally issued.
//
// This check is intentionally separate from `@simplewebauthn/server`'s signature
// verification: SimpleWebAuthn validates that *some* `payment.get` ceremony with
// the right challenge / origin happened, but does not look at the `payment`
// payload. Without the check here, an attacker who can swap clientDataJSON
// between two concurrent SPC requests against the same user could redirect
// payment confirmation to a different total or merchant. That is exactly the
// dynamic-linking attack PSD2 SCA exists to prevent.

export function base64urlDecodeToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}

export interface SpcLinkingExpected {
  rpId: string
  payeeOrigin: string
  value: string
  currencyAlpha: string
  instrumentDisplayName: string
  instrumentIcon: string
}

export type SpcLinkingResult = { ok: true } | { ok: false; reason: string }

export function verifySpcPaymentClientData(
  clientDataB64url: string,
  expected: SpcLinkingExpected,
): SpcLinkingResult {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(base64urlDecodeToString(clientDataB64url))
  } catch {
    return { ok: false, reason: 'clientDataJSON not parseable' }
  }

  if (parsed.type !== 'payment.get') {
    return {
      ok: false,
      reason: `clientDataJSON.type=${String(parsed.type)} (expected payment.get)`,
    }
  }

  const payment = parsed.payment as Record<string, unknown> | undefined
  if (!payment || typeof payment !== 'object') {
    return { ok: false, reason: 'clientDataJSON.payment missing' }
  }

  if (payment.rpId !== expected.rpId) {
    return {
      ok: false,
      reason: `payment.rpId=${String(payment.rpId)} (expected ${expected.rpId})`,
    }
  }

  if (payment.payeeOrigin !== expected.payeeOrigin) {
    return {
      ok: false,
      reason: `payment.payeeOrigin=${String(payment.payeeOrigin)} (expected ${expected.payeeOrigin})`,
    }
  }

  const total = payment.total as { value?: unknown; currency?: unknown } | undefined
  if (!total) return { ok: false, reason: 'payment.total missing' }

  if (String(total.value) !== expected.value) {
    return {
      ok: false,
      reason: `payment.total.value=${String(total.value)} (expected ${expected.value})`,
    }
  }

  if (total.currency !== expected.currencyAlpha) {
    return {
      ok: false,
      reason: `payment.total.currency=${String(total.currency)} (expected ${expected.currencyAlpha})`,
    }
  }

  const instrument = payment.instrument as { displayName?: unknown; icon?: unknown } | undefined
  if (!instrument) return { ok: false, reason: 'payment.instrument missing' }

  if (instrument.displayName !== expected.instrumentDisplayName) {
    return {
      ok: false,
      reason: `payment.instrument.displayName=${String(instrument.displayName)} (expected ${expected.instrumentDisplayName})`,
    }
  }

  if (instrument.icon !== expected.instrumentIcon) {
    return { ok: false, reason: 'payment.instrument.icon mismatch' }
  }

  return { ok: true }
}
