import React, { useState, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'

const ACS_URL = `http://${window.location.hostname}:3004`
const TEST_CARD_PAN = '4111111111111111'

type AuthFlow = 'frictionless' | 'otp' | 'webauthn' | 'spc'

const PRODUCTS = [
  {
    id: 'p1',
    name: 'Wireless Earbuds Pro',
    price: 12800,
    image: '🎧',
    authFlow: 'frictionless' as AuthFlow,
    flowLabel: 'Frictionless',
    flowColor: '#48bb78',
    flowDesc: 'No authentication required',
  },
  {
    id: 'p2',
    name: 'Smartwatch Elite',
    price: 34800,
    image: '⌚',
    authFlow: 'otp' as AuthFlow,
    flowLabel: 'OTP',
    flowColor: '#ed8936',
    flowDesc: 'OTP → Passkey enrollment',
  },
  {
    id: 'p3',
    name: 'Mechanical Keyboard',
    price: 18500,
    image: '⌨️',
    authFlow: 'webauthn' as AuthFlow,
    flowLabel: 'WebAuthn',
    flowColor: '#667eea',
    flowDesc: 'Passkey auth → OTP fallback',
  },
  {
    id: 'p4',
    name: 'Gaming Headset',
    price: 24800,
    image: '🎮',
    authFlow: 'spc' as AuthFlow,
    flowLabel: 'SPC',
    flowColor: '#9f7aea',
    flowDesc: 'SPC → OTP fallback',
  },
]

type Product = typeof PRODUCTS[0]

type FlowState =
  | { step: 'shop' }
  | { step: 'confirm'; product: Product }
  | { step: 'processing' }
  | { step: 'challenge'; acsTransId: string; acsURL: string }
  | { step: 'success'; authType: string; method: string; acsTransId: string }
  | { step: 'failure'; reason: string }

export function Checkout() {
  const [state, setState] = useState<FlowState>({ step: 'shop' })
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === '3ds-challenge-complete') {
        if (e.data.result === 'authenticated') {
          setState({ step: 'success', authType: 'CHALLENGE', method: e.data.method ?? 'Unknown', acsTransId: e.data.acsTransId })
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  async function submitPayment(product: Product) {
    setState({ step: 'processing' })

    const transId = uuidv4()
    const ua = navigator.userAgent

    try {
      const res = await fetch('/threeds/areq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threeDSServerTransID: transId,
          cardNumber: TEST_CARD_PAN,
          merchantID: 'merchant-001',
          merchantName: 'Test Shop',
          purchaseAmount: product.price,
          purchaseCurrency: '392',
          deviceChannel: '02',
          authFlow: product.authFlow,
          browserInfo: {
            userAgent: ua,
            language: navigator.language,
            screenWidth: screen.width,
            screenHeight: screen.height,
          },
        }),
      })

      const data = await res.json()

      if (data.transStatus === 'Y') {
        setState({ step: 'success', authType: 'FRICTIONLESS', method: 'Frictionless', acsTransId: data.acsTransID })
      } else if (data.transStatus === 'C') {
        const challengeUrl = `${ACS_URL}/challenge/${data.acsTransID}`
        setState({ step: 'challenge', acsTransId: data.acsTransID, acsURL: challengeUrl })
      } else {
        setState({ step: 'failure', reason: 'Authentication failed' })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      console.error('[checkout] submitPayment error', e)
      setState({ step: 'failure', reason: msg })
    }
  }

  if (state.step === 'shop') {
    return (
      <div style={s.page}>
        <header style={s.header}>
          <span style={s.storeName}>🛍️ Test Shop</span>
          <span style={s.badge}>3DS Passkey MVP</span>
        </header>
        <main style={s.main}>
          <h2 style={s.heading}>Featured Products</h2>
          <div style={s.grid}>
            {PRODUCTS.map(p => (
              <div key={p.id} style={s.productCard}>
                <div style={s.productEmoji}>{p.image}</div>
                <div style={s.productName}>{p.name}</div>
                <div style={s.productPrice}>¥{p.price.toLocaleString()}</div>
                <div style={{ ...s.flowBadge, background: p.flowColor + '22', color: p.flowColor }}>
                  {p.flowLabel}
                </div>
                <div style={s.flowDesc}>{p.flowDesc}</div>
                <button style={s.buyBtn} onClick={() => setState({ step: 'confirm', product: p })}>
                  Buy Now
                </button>
              </div>
            ))}
          </div>
        </main>
      </div>
    )
  }

  if (state.step === 'confirm') {
    const p = state.product
    return (
      <div style={s.page}>
        <header style={s.header}>
          <span style={s.storeName}>🛍️ Test Shop</span>
          <span style={s.badge}>Payment</span>
        </header>
        <main style={{ ...s.main, maxWidth: 480, margin: '0 auto' }}>
          <div style={s.orderSummary}>
            <div style={s.orderEmoji}>{p.image}</div>
            <div>
              <div style={s.orderName}>{p.name}</div>
              <div style={s.orderPrice}>¥{p.price.toLocaleString()}</div>
            </div>
          </div>

          <div style={s.cardInfo}>
            <div style={s.cardInfoLabel}>Test Card</div>
            <div style={s.cardInfoPan}>•••• •••• •••• 1111</div>
            <div style={{ ...s.flowBadge, background: p.flowColor + '22', color: p.flowColor, marginTop: 8, display: 'inline-block' }}>
              {p.flowLabel}: {p.flowDesc}
            </div>
          </div>

          <button
            style={s.payBtn}
            onClick={() => submitPayment(p)}
          >
            Pay ¥{p.price.toLocaleString()}
          </button>
          <button style={s.backBtn} onClick={() => setState({ step: 'shop' })}>
            Back
          </button>
        </main>
      </div>
    )
  }

  if (state.step === 'processing') {
    return (
      <div style={s.centered}>
        <div style={s.spinner} />
        <p style={s.processingText}>Processing...</p>
      </div>
    )
  }

  if (state.step === 'challenge') {
    return (
      <div style={s.page}>
        <header style={s.header}>
          <span style={s.storeName}>🛍️ Test Shop</span>
          <span style={s.badge}>Identity Verification</span>
        </header>
        <main style={s.challengeMain}>
          <p style={s.challengeNote}>
            Identity verification is required to complete your purchase.
          </p>
          <iframe
            ref={iframeRef}
            src={state.acsURL}
            allow="publickey-credentials-get *; publickey-credentials-create *; payment *"
            style={s.iframe}
            title="3DS Challenge"
          />
        </main>
      </div>
    )
  }

  if (state.step === 'success') {
    return (
      <div style={s.centered}>
        <div style={s.successIcon}>✓</div>
        <h2 style={s.successTitle}>Order Complete</h2>
        <p style={s.successSub}>
          Auth method: <strong>{state.method}</strong>
        </p>
        <p style={{ ...s.successSub, fontSize: 12, color: '#aaa', marginTop: 4 }}>
          acsTransId: {state.acsTransId}
        </p>
        <button style={s.restartBtn} onClick={() => setState({ step: 'shop' })}>
          Continue Shopping
        </button>
      </div>
    )
  }

  if (state.step === 'failure') {
    return (
      <div style={s.centered}>
        <div style={s.failIcon}>✗</div>
        <h2 style={s.failTitle}>Authentication Failed</h2>
        <p style={s.successSub}>{state.reason}</p>
        <button style={s.restartBtn} onClick={() => setState({ step: 'shop' })}>
          Try Again
        </button>
      </div>
    )
  }

  return null
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f8fa' },
  header: {
    background: '#fff',
    borderBottom: '1px solid #e2e8f0',
    padding: '16px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  storeName: { fontSize: 20, fontWeight: 700, color: '#333' },
  badge: {
    background: '#667eea',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 20,
  },
  main: { padding: '32px 24px' },
  heading: { fontSize: 22, fontWeight: 700, color: '#222', marginBottom: 20 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 20,
  },
  productCard: {
    background: '#fff',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  productEmoji: { fontSize: 48 },
  productName: { fontSize: 15, fontWeight: 600, textAlign: 'center', color: '#333' },
  productPrice: { fontSize: 20, fontWeight: 700, color: '#667eea' },
  flowBadge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: 20,
  },
  flowDesc: { fontSize: 11, color: '#999', textAlign: 'center' },
  buyBtn: {
    width: '100%',
    padding: '10px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 4,
  },
  orderSummary: {
    background: '#fff',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  orderEmoji: { fontSize: 40 },
  orderName: { fontSize: 16, fontWeight: 600, color: '#333' },
  orderPrice: { fontSize: 20, fontWeight: 700, color: '#667eea', marginTop: 4 },
  cardInfo: {
    background: '#f7f8fa',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '14px 16px',
    marginBottom: 20,
  },
  cardInfoLabel: { fontSize: 11, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  cardInfoPan: { fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: '#444', letterSpacing: 2 },
  payBtn: {
    width: '100%',
    padding: '16px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 18,
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 10,
  },
  backBtn: {
    width: '100%',
    padding: '12px',
    background: 'transparent',
    color: '#888',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 14,
    cursor: 'pointer',
  },
  centered: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    background: '#f7f8fa',
  },
  spinner: {
    width: 48,
    height: 48,
    border: '4px solid #e2e8f0',
    borderTop: '4px solid #667eea',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  processingText: { color: '#888', fontSize: 16 },
  challengeMain: { padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  challengeNote: { fontSize: 14, color: '#666', marginBottom: 20 },
  iframe: {
    width: 390,
    height: 500,
    border: 'none',
    borderRadius: 16,
    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
  },
  successIcon: {
    width: 64,
    height: 64,
    background: '#48bb78',
    color: '#fff',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 32,
  },
  successTitle: { fontSize: 24, fontWeight: 700, color: '#333' },
  successSub: { fontSize: 14, color: '#666' },
  failIcon: {
    width: 64,
    height: 64,
    background: '#e53e3e',
    color: '#fff',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 32,
  },
  failTitle: { fontSize: 24, fontWeight: 700, color: '#333' },
  restartBtn: {
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 8,
  },
}
