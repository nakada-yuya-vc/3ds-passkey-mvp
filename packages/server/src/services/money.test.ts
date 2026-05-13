import { describe, it, expect } from 'vitest'
import { currencyAlphaFromNumeric, formatMoneyForSpc } from './money'

describe('currencyAlphaFromNumeric', () => {
  it('maps known ISO 4217 numeric codes to alphabetic', () => {
    expect(currencyAlphaFromNumeric('392')).toBe('JPY')
    expect(currencyAlphaFromNumeric('840')).toBe('USD')
    expect(currencyAlphaFromNumeric('978')).toBe('EUR')
    expect(currencyAlphaFromNumeric('826')).toBe('GBP')
  })

  it('returns undefined for unknown codes', () => {
    expect(currencyAlphaFromNumeric('999')).toBeUndefined()
    expect(currencyAlphaFromNumeric('')).toBeUndefined()
  })
})

describe('formatMoneyForSpc', () => {
  // JPY has exponent 0 — minor unit IS the major unit.
  it('formats JPY (exponent 0) without a fractional part', () => {
    expect(formatMoneyForSpc(0, 'JPY')).toBe('0')
    expect(formatMoneyForSpc(1, 'JPY')).toBe('1')
    expect(formatMoneyForSpc(24800, 'JPY')).toBe('24800')
  })

  // USD/EUR/GBP have exponent 2 — minor unit is 1/100 of the major unit.
  it('formats USD (exponent 2) with two-digit fractional part', () => {
    expect(formatMoneyForSpc(0, 'USD')).toBe('0.00')
    expect(formatMoneyForSpc(1, 'USD')).toBe('0.01')
    expect(formatMoneyForSpc(99, 'USD')).toBe('0.99')
    expect(formatMoneyForSpc(100, 'USD')).toBe('1.00')
    expect(formatMoneyForSpc(24800, 'USD')).toBe('248.00')
    expect(formatMoneyForSpc(24850, 'USD')).toBe('248.50')
  })

  it('matches USD behaviour for EUR and GBP (same exponent)', () => {
    expect(formatMoneyForSpc(24800, 'EUR')).toBe('248.00')
    expect(formatMoneyForSpc(24800, 'GBP')).toBe('248.00')
  })

  it('handles negative values with the sign in front of the integer part', () => {
    expect(formatMoneyForSpc(-100, 'USD')).toBe('-1.00')
    expect(formatMoneyForSpc(-1, 'USD')).toBe('-0.01')
    expect(formatMoneyForSpc(-1, 'JPY')).toBe('-1')
  })

  it('throws on unknown currency rather than silently emitting the wrong string', () => {
    // Loud failure here is critical — silently returning "248" instead of "248.00"
    // would desync /spc/options and /spc/verify and produce a confusing 401 dynamic
    // linking mismatch at runtime.
    expect(() => formatMoneyForSpc(100, 'XXX')).toThrow(/unsupported currency/i)
  })

  it('throws on non-integer minor units', () => {
    expect(() => formatMoneyForSpc(1.5, 'USD')).toThrow(/integer/i)
  })
})
