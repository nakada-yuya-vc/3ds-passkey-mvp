import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { OtpChallenge } from './OtpChallenge'
import { PasskeyChallenge } from './PasskeyChallenge'
import { SpcChallenge } from './SpcChallenge'
import { EnrollPasskey } from './EnrollPasskey'

type Phase = 'loading' | 'otp' | 'passkey' | 'spc' | 'enroll' | 'done' | 'error'

interface TransactionInfo {
  acsTransId: string
  authType: 'OTP' | 'PASSKEY' | 'PASSKEY_SPC' | 'FRICTIONLESS'
  merchantName: string | null
  purchaseAmount: number
  hasPasskey: boolean
  credentials: Array<{ credentialId: string; spcCapable: boolean; transports: string[] }>
}

export function ChallengePage() {
  const { acsTransId } = useParams<{ acsTransId: string }>()
  const [phase, setPhase] = useState<Phase>('loading')
  const [txInfo, setTxInfo] = useState<TransactionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!acsTransId) return
    loadTransactionInfo()
  }, [acsTransId])

  async function loadTransactionInfo() {
    try {
      const res = await fetch(`/threeds/transaction/${acsTransId}`)
      if (!res.ok) throw new Error('Transaction not found')
      const info: TransactionInfo = await res.json()
      setTxInfo(info)

      if (info.authType === 'OTP') {
        setPhase('otp')
      } else if (info.authType === 'PASSKEY' || info.authType === 'PASSKEY_SPC') {
        const hasSpc = info.credentials.some(c => c.spcCapable)
        const spcAvailable = await checkSpcAvailability()
        if (hasSpc && spcAvailable) {
          setPhase('spc')
        } else {
          setPhase('passkey')
        }
      } else {
        setPhase('done')
      }
    } catch (e) {
      setError('Failed to load transaction information')
      setPhase('error')
    }
  }

  async function checkSpcAvailability(): Promise<boolean> {
    try {
      if (typeof PaymentRequest === 'undefined') return false
      const pr = new PaymentRequest(
        [{
          supportedMethods: 'secure-payment-confirmation',
          data: {
            credentialIds: [new Uint8Array(32)],
            rpId: window.location.hostname,
            challenge: new Uint8Array(32),
            instrument: { displayName: 'test', icon: 'https://example.com' },
          },
        }],
        { total: { label: 'test', amount: { currency: 'JPY', value: '0' } } }
      )
      return await pr.canMakePayment()
    } catch {
      return false
    }
  }

  function handleOtpSuccess() {
    setPhase('enroll')
  }

  function handleEnrollDone() {
    setPhase('done')
    notifyParent('authenticated')
  }

  function handleEnrollSkip() {
    setPhase('done')
    notifyParent('authenticated')
  }

  function handlePasskeySuccess() {
    setPhase('done')
    notifyParent('authenticated')
  }

  function notifyParent(result: string) {
    window.parent.postMessage({ type: '3ds-challenge-complete', result, acsTransId }, '*')
  }

  if (phase === 'loading') {
    return <Layout><p style={styles.loading}>Loading...</p></Layout>
  }

  if (phase === 'error') {
    return <Layout><p style={styles.error}>{error}</p></Layout>
  }

  if (phase === 'done') {
    return (
      <Layout>
        <div style={styles.successBox}>
          <div style={styles.successIcon}>✓</div>
          <p>Authentication complete</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout merchantName={txInfo?.merchantName} amount={txInfo?.purchaseAmount}>
      {phase === 'otp' && (
        <OtpChallenge acsTransId={acsTransId!} onSuccess={handleOtpSuccess} />
      )}
      {phase === 'enroll' && (
        <EnrollPasskey
          acsTransId={acsTransId!}
          onDone={handleEnrollDone}
          onSkip={handleEnrollSkip}
        />
      )}
      {phase === 'passkey' && (
        <PasskeyChallenge acsTransId={acsTransId!} onSuccess={handlePasskeySuccess} />
      )}
      {phase === 'spc' && txInfo && (
        <SpcChallenge
          acsTransId={acsTransId!}
          credentials={txInfo.credentials}
          merchantName={txInfo.merchantName ?? ''}
          amount={txInfo.purchaseAmount}
          onSuccess={handlePasskeySuccess}
        />
      )}
    </Layout>
  )
}

function Layout({
  children,
  merchantName,
  amount,
}: {
  children: React.ReactNode
  merchantName?: string | null
  amount?: number
}) {
  return (
    <div style={s.container}>
      <div style={s.card}>
        <div style={s.header}>
          <div style={s.logo}>🔐</div>
          <div>
            <div style={s.title}>Identity Verification</div>
            {merchantName && (
              <div style={s.subtitle}>
                {merchantName}
                {amount !== undefined && ` — ¥${amount.toLocaleString()}`}
              </div>
            )}
          </div>
        </div>
        <div style={s.body}>{children}</div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  loading: { textAlign: 'center', color: '#888', padding: 24 },
  error: { color: '#e53e3e', textAlign: 'center', padding: 24 },
  successBox: { textAlign: 'center', padding: 16 },
  successIcon: {
    fontSize: 40,
    color: '#48bb78',
    marginBottom: 8,
  },
}

const s: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: 16,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    width: '100%',
    maxWidth: 380,
    overflow: 'hidden',
  },
  header: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#fff',
    padding: '20px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  logo: { fontSize: 32 },
  title: { fontSize: 18, fontWeight: 700 },
  subtitle: { fontSize: 13, opacity: 0.85, marginTop: 2 },
  body: { padding: 24 },
}
