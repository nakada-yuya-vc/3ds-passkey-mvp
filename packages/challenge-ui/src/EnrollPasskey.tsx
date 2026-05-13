import React, { useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'

interface Props {
  acsTransId: string
  onDone: () => void
  onSkip: () => void
}

export function EnrollPasskey({ acsTransId, onDone, onSkip }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const webAuthnAvailable = typeof window !== 'undefined'
    && window.isSecureContext
    && typeof window.PublicKeyCredential === 'function'

  if (!webAuthnAvailable) {
    return (
      <div style={s.container}>
        <div style={s.icon}>ℹ️</div>
        <h3 style={s.title}>Passkey registration unavailable here</h3>
        <p style={s.desc}>
          This page is not running in a secure context (HTTPS or localhost), so a passkey
          cannot be registered on this device right now. You can complete this purchase
          and register a passkey later from a secure URL.
        </p>
        <p style={s.hint}>
          Current origin: <code>{typeof window !== 'undefined' ? window.location.origin : ''}</code>
        </p>
        <button style={s.btn} onClick={onSkip}>
          Continue
        </button>
      </div>
    )
  }

  async function handleEnroll() {
    setLoading(true)
    setError(null)

    try {
      // サーバーから登録オプションを取得
      const optRes = await fetch(`/webauthn/register/options?acsTransId=${acsTransId}`)
      if (!optRes.ok) throw new Error('Failed to fetch registration options')
      const optionsJSON = await optRes.json()

      const credential = await startRegistration(optionsJSON)

      const verifyRes = await fetch('/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acsTransId, credential }),
      })

      if (!verifyRes.ok) {
        const d = await verifyRes.json().catch(() => ({}))
        throw new Error(d.error || 'Registration failed')
      }

      onDone()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      if (msg.includes('NotAllowedError') || msg.includes('cancelled')) {
        setError('Registration was cancelled')
      } else {
        setError(msg)
      }
      setLoading(false)
    }
  }

  return (
    <div style={s.container}>
      <div style={s.icon}>✨</div>
      <h3 style={s.title}>Faster next time</h3>
      <p style={s.desc}>
        Register a passkey and verify your identity instantly with biometrics
        on your next purchase.
      </p>
      <p style={s.hint}>
        💡 The passkey will be bound to this device (e.g. Windows Hello / Touch ID) so it can
        be used for Secure Payment Confirmation. It will not sync to other devices.
      </p>

      <div style={s.benefits}>
        {['No SMS code needed', 'More secure', 'Faster'].map(b => (
          <div key={b} style={s.benefit}>
            <span style={s.check}>✓</span>
            <span>{b}</span>
          </div>
        ))}
      </div>

      {error && <p style={s.error}>{error}</p>}

      <button
        style={{ ...s.btn, opacity: loading ? 0.6 : 1 }}
        onClick={handleEnroll}
        disabled={loading}
      >
        {loading ? 'Registering...' : 'Register Passkey'}
      </button>

      <button style={s.skip} onClick={onSkip} disabled={loading}>
        Not now
      </button>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: { textAlign: 'center' },
  icon: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#333' },
  desc: { fontSize: 14, color: '#666', lineHeight: 1.6, marginBottom: 10 },
  hint: { fontSize: 12, color: '#888', lineHeight: 1.5, marginBottom: 16, background: '#f7f8fa', borderRadius: 6, padding: '8px 10px', textAlign: 'left' as const },
  benefits: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, textAlign: 'left' },
  benefit: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#444' },
  check: { color: '#48bb78', fontWeight: 700, fontSize: 16 },
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
    marginBottom: 10,
  },
  skip: {
    width: '100%',
    padding: '10px',
    background: 'transparent',
    color: '#888',
    border: 'none',
    fontSize: 14,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
}
