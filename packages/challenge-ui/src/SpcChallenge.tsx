import React, { useEffect, useState } from 'react'

interface Props {
  acsTransId: string
  credentials: Array<{ credentialId: string; spcCapable: boolean; transports: string[] }>
  merchantName: string
  amount: number
  onSuccess: () => void
}

function base64urlToBuffer(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function SpcChallenge({ acsTransId, credentials, merchantName, amount, onSuccess }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function triggerSPC() {
    setLoading(true)
    setError(null)

    try {
      const optRes = await fetch(`/spc/options?acsTransId=${acsTransId}`)
      if (!optRes.ok) throw new Error('Failed to fetch SPC options')
      const opts = await optRes.json()

      const spcCredentials = credentials.filter(c => c.spcCapable)
      const credentialIds = spcCredentials.map(c => base64urlToBuffer(c.credentialId))

      const request = new PaymentRequest(
        [{
          supportedMethods: 'secure-payment-confirmation',
          data: {
            credentialIds,
            challenge: base64urlToBuffer(opts.challenge),
            rpId: opts.rpId,
            payeeOrigin: opts.payeeOrigin,
            instrument: {
              displayName: opts.merchantName ?? merchantName,
              icon: `${window.location.origin}/favicon.ico`,
            },
            timeout: 60000,
          },
        }],
        {
          total: {
            label: opts.merchantName ?? merchantName,
            amount: { currency: 'JPY', value: String(amount) },
          },
        }
      )

      const response = await request.show()
      const assertion = response.details

      const verifyRes = await fetch('/spc/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acsTransId, assertion }),
      })

      if (!verifyRes.ok) {
        await response.complete('fail')
        throw new Error('SPC authentication failed')
      }

      await response.complete('success')
      onSuccess()
    } catch (e: unknown) {
      const isNotAllowed = e instanceof DOMException && e.name === 'NotAllowedError'
      const msg = isNotAllowed
        ? 'No matching passkey found on this device. Please re-register your passkey.'
        : (e instanceof Error ? e.message : 'Unknown error')
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <div style={s.container}>
      <div style={s.icon}>💳</div>
      <h3 style={s.title}>Payment Authentication</h3>
      <p style={s.desc}>
        Approve your payment with Secure Payment Confirmation.
        <br />Use biometrics to confirm securely.
      </p>
      {loading ? (
        <div style={s.spinner}>
          <p style={s.loadingText}>Check the browser authentication dialog...</p>
        </div>
      ) : (
        <button style={s.btn} onClick={triggerSPC} disabled={loading}>
          Confirm Payment
        </button>
      )}
      {error && (
        <div>
          <p style={s.error}>{error}</p>
          <button style={s.btn} onClick={triggerSPC}>Retry</button>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: { textAlign: 'center', padding: '8px 0' },
  icon: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#333' },
  desc: { fontSize: 14, color: '#666', lineHeight: 1.6, marginBottom: 20 },
  spinner: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 14, color: '#888' },
  error: { color: '#e53e3e', fontSize: 13, marginBottom: 12 },
  btn: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
