import React, { useEffect, useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'

interface Props {
  acsTransId: string
  onSuccess: () => void
}

export function PasskeyChallenge({ acsTransId, onSuccess }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!started) {
      setStarted(true)
      triggerAuthentication()
    }
  }, [])

  async function triggerAuthentication() {
    setLoading(true)
    setError(null)

    try {
      const optRes = await fetch(`/webauthn/authenticate/options?acsTransId=${acsTransId}`)
      if (!optRes.ok) throw new Error('オプション取得失敗')
      const options = await optRes.json()

      const credential = await startAuthentication(options)

      const verifyRes = await fetch('/webauthn/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acsTransId, credential }),
      })

      if (!verifyRes.ok) {
        const d = await verifyRes.json().catch(() => ({}))
        throw new Error(d.error || '認証失敗')
      }

      onSuccess()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '不明なエラー'
      if (msg.includes('NotAllowedError') || msg.includes('cancelled')) {
        setError('認証がキャンセルされました')
      } else {
        setError(msg)
      }
      setLoading(false)
    }
  }

  return (
    <div style={s.container}>
      <div style={s.icon}>🔑</div>
      <h3 style={s.title}>パスキーで認証</h3>
      <p style={s.desc}>
        お使いのデバイスの生体認証（Face ID / Touch ID / 指紋認証）で本人確認を行います。
      </p>
      {loading && (
        <div style={s.spinner}>
          <div style={s.dot} />
          <p style={s.loadingText}>認証中...</p>
        </div>
      )}
      {error && (
        <div>
          <p style={s.error}>{error}</p>
          <button style={s.btn} onClick={triggerAuthentication}>
            再試行
          </button>
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
  dot: {
    width: 40,
    height: 40,
    border: '4px solid #e2e8f0',
    borderTop: '4px solid #667eea',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
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
