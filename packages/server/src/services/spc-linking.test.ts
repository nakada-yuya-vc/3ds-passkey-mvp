import { describe, it, expect } from 'vitest'
import { verifySpcPaymentClientData } from './spc-linking'
import { buildSpcDisplayData } from './spc-display'

// Build a base64url-encoded clientDataJSON shaped like the SPC spec defines, so
// we can drive `verifySpcPaymentClientData` from realistic payloads without
// invoking a real browser. Each test mutates exactly one field of the baseline
// to prove the verifier rejects that specific mismatch.
function makeClientDataB64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

const EXPECTED = {
  rpId: 'localhost',
  payeeOrigin: 'https://merchant.example.com',
  value: '24800',
  currencyAlpha: 'JPY',
  instrumentDisplayName: buildSpcDisplayData('Test Shop').instrument.displayName,
  instrumentIcon: buildSpcDisplayData('Test Shop').instrument.icon,
} as const

function baselineClientData() {
  return {
    type: 'payment.get',
    challenge: 'YWJjZGVm',
    origin: 'http://localhost:3004',
    crossOrigin: false,
    payment: {
      rpId: 'localhost',
      topOrigin: 'https://merchant.example.com',
      payeeOrigin: 'https://merchant.example.com',
      total: { value: '24800', currency: 'JPY' },
      instrument: buildSpcDisplayData('Test Shop').instrument,
    },
  }
}

describe('verifySpcPaymentClientData', () => {
  it('accepts a baseline payload that matches every expected field', () => {
    const result = verifySpcPaymentClientData(
      makeClientDataB64url(baselineClientData()),
      EXPECTED,
    )
    expect(result.ok).toBe(true)
  })

  it('rejects when clientDataJSON.type is not "payment.get"', () => {
    const data = baselineClientData()
    ;(data as { type: string }).type = 'webauthn.get'
    const result = verifySpcPaymentClientData(makeClientDataB64url(data), EXPECTED)
    expect(result).toEqual({
      ok: false,
      reason: 'clientDataJSON.type=webauthn.get (expected payment.get)',
    })
  })

  it('rejects when the payment member is absent', () => {
    const data = baselineClientData() as Record<string, unknown>
    delete data.payment
    const result = verifySpcPaymentClientData(makeClientDataB64url(data), EXPECTED)
    expect(result).toEqual({ ok: false, reason: 'clientDataJSON.payment missing' })
  })

  it('rejects when payment.rpId is for a different RP', () => {
    const data = baselineClientData()
    data.payment.rpId = 'attacker.example'
    const result = verifySpcPaymentClientData(makeClientDataB64url(data), EXPECTED)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/payment\.rpId=attacker\.example/)
  })

  it('rejects when payment.payeeOrigin is for a different merchant', () => {
    const data = baselineClientData()
    data.payment.payeeOrigin = 'https://other-merchant.example.com'
    const result = verifySpcPaymentClientData(makeClientDataB64url(data), EXPECTED)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/payment\.payeeOrigin=https:\/\/other-merchant/)
  })

  it('rejects when payment.total.value does not match the issued amount', () => {
    const data = baselineClientData()
    data.payment.total.value = '99999'
    const result = verifySpcPaymentClientData(makeClientDataB64url(data), EXPECTED)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/payment\.total\.value=99999/)
  })

  it('rejects when payment.total.currency does not match', () => {
    const data = baselineClientData()
    data.payment.total.currency = 'USD'
    const result = verifySpcPaymentClientData(makeClientDataB64url(data), EXPECTED)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/payment\.total\.currency=USD/)
  })

  it('rejects when payment.total is missing entirely', () => {
    const data = baselineClientData() as { payment: Record<string, unknown> }
    delete data.payment.total
    const result = verifySpcPaymentClientData(makeClientDataB64url(data), EXPECTED)
    expect(result).toEqual({ ok: false, reason: 'payment.total missing' })
  })

  it('rejects when payment.instrument is missing entirely', () => {
    const data = baselineClientData() as { payment: Record<string, unknown> }
    delete data.payment.instrument
    const result = verifySpcPaymentClientData(makeClientDataB64url(data), EXPECTED)
    expect(result).toEqual({ ok: false, reason: 'payment.instrument missing' })
  })

  it('rejects when payment.instrument.displayName does not match', () => {
    const data = baselineClientData()
    data.payment.instrument.displayName = 'Different Card'
    const result = verifySpcPaymentClientData(makeClientDataB64url(data), EXPECTED)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/payment\.instrument\.displayName=Different Card/)
    }
  })

  it('rejects when payment.instrument.icon does not match', () => {
    const data = baselineClientData()
    data.payment.instrument.icon = 'data:image/svg+xml,%3Csvg%20/%3E'
    const result = verifySpcPaymentClientData(makeClientDataB64url(data), EXPECTED)
    expect(result).toEqual({ ok: false, reason: 'payment.instrument.icon mismatch' })
  })

  it('rejects malformed base64url that is not parseable JSON', () => {
    const result = verifySpcPaymentClientData('not-valid-base64url-json', EXPECTED)
    expect(result).toEqual({ ok: false, reason: 'clientDataJSON not parseable' })
  })

  // Regression: the verifier must enforce one mismatch at a time but should not
  // gloss over a value mismatch if the currency also happens to match. The order
  // of the checks is part of the contract — reviewers want to see exactly which
  // dynamic-linking invariant failed.
  it('reports value mismatch before currency mismatch when both are wrong', () => {
    const data = baselineClientData()
    data.payment.total.value = '99999'
    data.payment.total.currency = 'USD'
    const result = verifySpcPaymentClientData(makeClientDataB64url(data), EXPECTED)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/payment\.total\.value=99999/)
  })
})
