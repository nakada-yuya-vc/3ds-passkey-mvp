// ISO 4217 helpers used by the SPC integration.
//
// The 3DS AReq carries currency as the ISO 4217 numeric code (e.g. "392"), and
// `Transaction.purchaseAmount` stores the amount as **minor units** of that
// currency (yen for JPY, cents for USD/EUR). The W3C Payment Request API used
// by SPC, however, takes the alphabetic code ("JPY") and a decimal string
// formatted according to the currency's minor-unit exponent ("248.00").
//
// Keep both tables here so the conversion is in exactly one place and the
// SPC dynamic-linking check on /spc/verify uses the same formatter as the
// `total` we hand to the browser in /spc/options.

export const ISO_4217_NUM_TO_ALPHA: Record<string, string> = {
  '392': 'JPY',
  '840': 'USD',
  '978': 'EUR',
  '826': 'GBP',
}

// Minor-unit exponent per ISO 4217. JPY has no minor units; most others use 2.
// Currencies with exotic exponents (BHD/KWD/etc. = 3) should be added here as
// the MVP grows. Anything not in the table is rejected loudly so we never
// silently format the wrong way.
const ISO_4217_EXPONENT: Record<string, number> = {
  JPY: 0,
  USD: 2,
  EUR: 2,
  GBP: 2,
}

export function currencyAlphaFromNumeric(numeric: string): string | undefined {
  return ISO_4217_NUM_TO_ALPHA[numeric]
}

// Format minor units as a `PaymentCurrencyAmount.value` decimal string.
//   formatMoneyForSpc(24800, 'JPY') === "24800"
//   formatMoneyForSpc(24800, 'USD') === "248.00"
// Throws for unsupported currencies so we never produce an off-by-100 SPC
// payload that would silently fail the dynamic-linking check.
export function formatMoneyForSpc(minorUnits: number, currencyAlpha: string): string {
  const exp = ISO_4217_EXPONENT[currencyAlpha]
  if (exp === undefined) {
    throw new Error(`Unsupported currency for SPC formatting: ${currencyAlpha}`)
  }
  if (!Number.isInteger(minorUnits)) {
    throw new Error(`Minor units must be an integer: ${minorUnits}`)
  }
  if (exp === 0) return String(minorUnits)

  const negative = minorUnits < 0
  const absStr = String(Math.abs(minorUnits)).padStart(exp + 1, '0')
  const integer = absStr.slice(0, absStr.length - exp)
  const fraction = absStr.slice(absStr.length - exp)
  return (negative ? '-' : '') + integer + '.' + fraction
}
