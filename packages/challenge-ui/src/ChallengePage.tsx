import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { OtpChallenge } from './OtpChallenge'
import { PasskeyChallenge } from './PasskeyChallenge'
import { SpcChallenge } from './SpcChallenge'
import { EnrollPasskey } from './EnrollPasskey'

type Phase = 'loading' | 'otp' | 'passkey' | 'spc' | 'enroll' | 'done' | 'error'

const SPC_PROBE_ICON = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2296%22%20height%3D%2264%22%20viewBox%3D%220%200%2096%2064%22%3E%3Crect%20width%3D%2296%22%20height%3D%2264%22%20rx%3D%2210%22%20fill%3D%22%231F2937%22%2F%3E%3Crect%20x%3D%2210%22%20y%3D%2214%22%20width%3D%2222%22%20height%3D%2216%22%20rx%3D%223%22%20fill%3D%22%23F8D17C%22%2F%3E%3Cpath%20d%3D%22M12%2044h26M12%2052h42%22%20stroke%3D%22%23E5E7EB%22%20stroke-width%3D%224%22%20stroke-linecap%3D%22round%22%2F%3E%3Ccircle%20cx%3D%2268%22%20cy%3D%2242%22%20r%3D%229%22%20fill%3D%22%2360A5FA%22%2F%3E%3Ccircle%20cx%3D%2278%22%20cy%3D%2242%22%20r%3D%229%22%20fill%3D%22%23F472B6%22%20fill-opacity%3D%22.85%22%2F%3E%3C%2Fsvg%3E'

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

      const secure = window.isSecureContext
      const webAuthnSupported = typeof window.PublicKeyCredential === 'function'
      console.log('[challenge] env: isSecureContext=%s webAuthn=%s host=%s authType=%s',
        secure, webAuthnSupported, window.location.host, info.authType)

      if (info.authType === 'OTP') {
        console.log('[challenge] phase=otp')
        setPhase('otp')
      } else if (info.authType === 'PASSKEY' || info.authType === 'PASSKEY_SPC') {
        if (info.authType === 'PASSKEY_SPC' && (!secure || !webAuthnSupported)) {
          console.warn('[challenge] SPC unavailable in this context — falling back to OTP')
          await startOtpFallback('spc_insecure_context')
          return
        }

        // Plain WebAuthn requires a secure context (HTTPS or localhost).
        // On Android over Wi-Fi this is typically http://192.168.x.x which is NOT secure.
        if (!secure || !webAuthnSupported) {
          console.warn('[challenge] passkey flow but insecure context — cannot proceed')
          setError(
            `This page must be served over HTTPS (or accessed via "localhost") to use passkey authentication. ` +
            `Current origin: ${window.location.origin}. ` +
            `Tip: use a tunnel like ngrok, or enable HTTPS on the Vite dev server (e.g. with vite-plugin-mkcert).`
          )
          setPhase('error')
          return
        }

        if (info.authType === 'PASSKEY_SPC') {
          const spcAvailable = info.credentials.length > 0
            && await checkSpcAvailability(info.credentials.map(c => c.credentialId))
          console.log('[challenge] authType=PASSKEY_SPC spcAvailable=%s', spcAvailable)
          if (!spcAvailable) {
            await startOtpFallback('spc_unavailable')
            return
          }
          setPhase('spc')
        } else {
          console.log('[challenge] authType=PASSKEY phase=passkey')
          setPhase('passkey')
        }
      } else {
        setPhase('done')
      }
    } catch (e) {
      console.error('[challenge] loadTransactionInfo error', e)
      setError('Failed to load transaction information')
      setPhase('error')
    }
  }

  async function startOtpFallback(reason: string) {
    if (!acsTransId) return

    const res = await fetch('/threeds/fallback/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acsTransID: acsTransId, reason }),
    })

    if (!res.ok) {
      throw new Error('Failed to start OTP fallback')
    }

    setTxInfo(prev => prev ? { ...prev, authType: 'OTP' } : prev)
    setPhase('otp')
  }

  async function checkSpcAvailability(credentialIds: string[]): Promise<boolean> {
    try {
      if (typeof PaymentRequest === 'undefined') return false
      const ids = credentialIds.map(id => base64urlToBuffer(id))
      const pr = new PaymentRequest(
        [{
          supportedMethods: 'secure-payment-confirmation',
          data: {
            credentialIds: ids,
            rpId: window.location.hostname,
            challenge: new Uint8Array(32),
            payeeOrigin: window.location.origin.replace(/^http:\/\//, 'https://'),
            instrument: { displayName: 'test', icon: SPC_PROBE_ICON },
          },
        }],
        { total: { label: 'test', amount: { currency: 'JPY', value: '0' } } }
      )
      return await pr.canMakePayment()
    } catch {
      return false
    }
  }

  function base64urlToBuffer(base64url: string): Uint8Array {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  function handleOtpSuccess() {
    if (txInfo?.hasPasskey) {
      console.log('[challenge] result: OTP fallback')
      setPhase('done')
      notifyParent('authenticated', 'OTP fallback')
      return
    }

    setPhase('enroll')
  }

  function handleEnrollDone() {
    console.log('[challenge] result: OTP + Passkey registered')
    setPhase('done')
    notifyParent('authenticated', 'OTP + Passkey registered')
  }

  function handleEnrollSkip() {
    console.log('[challenge] result: OTP')
    setPhase('done')
    notifyParent('authenticated', 'OTP')
  }

  function handlePasskeySuccess() {
    console.log('[challenge] result: WebAuthn')
    setPhase('done')
    notifyParent('authenticated', 'WebAuthn')
  }

  function handleSpcSuccess() {
    console.log('[challenge] result: SPC')
    setPhase('done')
    notifyParent('authenticated', 'SPC')
  }


  function notifyParent(result: string, method: string) {
    window.parent.postMessage({ type: '3ds-challenge-complete', result, acsTransId, method }, '*')
  }

  if (phase === 'loading') {
    return <Layout><p style={styles.loading}>Loading...</p></Layout>
  }

  if (phase === 'error') {
    return <Layout><p style={styles.errorMsg}>{error}</p></Layout>
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
          onSuccess={handleSpcSuccess}
          onFallback={() => startOtpFallback('spc_error')}
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
  errorMsg: { color: '#e53e3e', padding: 24, lineHeight: 1.6, fontSize: 13, wordBreak: 'break-word' },
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
