function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export const SPC_INSTRUMENT_ICON = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <rect width="640" height="400" rx="56" fill="#111827"/>
  <rect x="64" y="88" width="140" height="96" rx="20" fill="#F8D17C"/>
  <path d="M80 264h168M80 320h280" stroke="#E5E7EB" stroke-width="28" stroke-linecap="round"/>
  <circle cx="452" cy="268" r="58" fill="#60A5FA"/>
  <circle cx="516" cy="268" r="58" fill="#F472B6" fill-opacity=".86"/>
  <path d="M78 48h484" stroke="#374151" stroke-width="18" stroke-linecap="round" opacity=".8"/>
</svg>
`.trim())

export interface SpcDisplayData {
  instrument: {
    displayName: string
    icon: string
  }
}

export function buildSpcDisplayData(_merchantName: string | null | undefined): SpcDisplayData {
  return {
    instrument: {
      displayName: 'Demo Card ending 1111',
      icon: SPC_INSTRUMENT_ICON,
    },
  }
}
