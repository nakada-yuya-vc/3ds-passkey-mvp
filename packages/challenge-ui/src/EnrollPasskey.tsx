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

  async function handleEnroll() {
    setLoading(true)
    setError(null)

    try {
      // サーバーから登録オプションを取得
      const optRes = await fetch(`/webauthn/register/options?acsTransId=${acsTransId}`)
      if (!optRes.ok) throw new Error('登録オプションの取得に失敗しました')
      const optionsJSON = await optRes.json()

      const credential = await startRegistration(optionsJSON)

      const verifyRes = await fetch('/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acsTransId, credential }),
      })

      if (!verifyRes.ok) {
        const d = await verifyRes.json().catch(() => ({}))
        throw new Error(d.error || '登録失敗')
      }

      onDone()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '不明なエラー'
      if (msg.includes('NotAllowedError') || msg.includes('cancelled')) {
        setError('登録がキャンセルされました')
      } else {
        setError(msg)
      }
      setLoading(false)
    }
  }

  return (
    <div style={s.container}>
      <div style={s.icon}>✨</div>
      <h3 style={s.title}>次回からもっと簡単に</h3>
      <p style={s.desc}>
        パスキーを登録すると、次回から生体認証（Face ID / Touch ID）だけで
        素早く本人確認ができます。
      </p>

      <div style={s.benefits}>
        {['SMSコード不要', 'より安全', 'より速い'].map(b => (
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
        {loading ? '登録中...' : 'パスキーを登録する'}
      </button>

      <button style={s.skip} onClick={onSkip} disabled={loading}>
        今は登録しない
      </button>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: { textAlign: 'center' },
  icon: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#333' },
  desc: { fontSize: 14, color: '#666', lineHeight: 1.6, marginBottom: 16 },
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
