import React, { useState } from 'react'

interface Props {
  acsTransId: string
  onSuccess: () => void
}

export function OtpChallenge({ acsTransId, onSuccess }: Props) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/threeds/creq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acsTransID: acsTransId, otpCode: code }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'OTPが正しくありません')
        return
      }

      const data = await res.json()
      if (data.status === 'show_enroll') {
        onSuccess()
      }
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <p style={s.desc}>
        ご登録の携帯電話に送信されたワンタイムパスワードを入力してください。
      </p>
      {process.env.NODE_ENV !== 'production' && (
        <p style={s.mock}>🔧 テストモード: OTPは <strong>123456</strong></p>
      )}
      <form onSubmit={handleSubmit}>
        <input
          style={s.input}
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="6桁のコード"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          autoFocus
        />
        {error && <p style={s.error}>{error}</p>}
        <button
          style={{ ...s.btn, opacity: loading || code.length !== 6 ? 0.6 : 1 }}
          type="submit"
          disabled={loading || code.length !== 6}
        >
          {loading ? '確認中...' : '確認する'}
        </button>
      </form>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  desc: { fontSize: 14, color: '#555', marginBottom: 16, lineHeight: 1.6 },
  mock: { fontSize: 12, color: '#888', background: '#f0f0f0', padding: '6px 10px', borderRadius: 6, marginBottom: 12 },
  input: {
    width: '100%',
    padding: '14px',
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    border: '2px solid #ddd',
    borderRadius: 8,
    marginBottom: 12,
    outline: 'none',
  },
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
