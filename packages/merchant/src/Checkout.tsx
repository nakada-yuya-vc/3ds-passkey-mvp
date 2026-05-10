import React, { useState, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'

const ACS_URL = 'http://localhost:3004'

const TEST_CARDS = [
  { pan: '4111111111111111', label: 'Frictionless (no challenge)', color: '#48bb78' },
  { pan: '4111111111111129', label: 'OTP Challenge', color: '#ed8936' },
  { pan: '4111111111111137', label: 'Passkey Challenge (enrolled)', color: '#667eea' },
  { pan: '4111111111111145', label: 'High amount → Challenge', color: '#e53e3e' },
]

const PRODUCTS = [
  { id: 'p1', name: 'Wireless Earbuds Pro', price: 12800, image: '🎧' },
  { id: 'p2', name: 'Smartwatch Elite', price: 34800, image: '⌚' },
  { id: 'p3', name: 'Mechanical Keyboard', price: 18500, image: '⌨️' },
]

type FlowState =
  | { step: 'shop' }
  | { step: 'card-select'; product: typeof PRODUCTS[0] }
  | { step: 'processing' }
  | { step: 'challenge'; acsTransId: string; acsURL: string }
  | { step: 'success'; authType: string; acsTransId: string }
  | { step: 'failure'; reason: string }

function computeDeviceHash(ua: string, w: number, h: number) {
  return btoa(`${ua}|${w}x${h}`).slice(0, 32)
}

export function Checkout() {
  const [state, setState] = useState<FlowState>({ step: 'shop' })
  const [selectedCard, setSelectedCard] = useState(TEST_CARDS[0])
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === '3ds-challenge-complete') {
        if (e.data.result === 'authenticated') {
          setState({ step: 'success', authType: 'PASSKEY', acsTransId: e.data.acsTransId })
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  async function startCheckout(product: typeof PRODUCTS[0]) {
    setState({ step: 'card-select', product })
  }

  async function submitPayment(product: typeof PRODUCTS[0]) {
    setState({ step: 'processing' })

    const transId = uuidv4()
    const ua = navigator.userAgent

    try {
      const cardHash = await sha256(selectedCard.pan)

      const res = await fetch('/threeds/areq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threeDSServerTransID: transId,
          cardNumberHash: cardHash,
          merchantID: 'merchant-001',
          merchantName: 'Test Shop',
          purchaseAmount: product.price,
          purchaseCurrency: '392',
          deviceChannel: '02',
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
        setState({ step: 'success', authType: 'FRICTIONLESS', acsTransId: data.acsTransID })
      } else if (data.transStatus === 'C') {
        const challengeUrl = `${ACS_URL}/challenge/${data.acsTransID}`
        setState({ step: 'challenge', acsTransId: data.acsTransID, acsURL: challengeUrl })
      } else {
        setState({ step: 'failure', reason: 'Authentication failed' })
      }
    } catch (e) {
      setState({ step: 'failure', reason: 'Network error' })
    }
  }

  async function sha256(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
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
                <button style={s.buyBtn} onClick={() => startCheckout(p)}>
                  Buy Now
                </button>
              </div>
            ))}
          </div>
        </main>
      </div>
    )
  }

  if (state.step === 'card-select') {
    return (
      <div style={s.page}>
        <header style={s.header}>
          <span style={s.storeName}>🛍️ Test Shop</span>
          <span style={s.badge}>Payment</span>
        </header>
        <main style={{ ...s.main, maxWidth: 480, margin: '0 auto' }}>
          <div style={s.orderSummary}>
            <div style={s.orderEmoji}>{state.product.image}</div>
            <div>
              <div style={s.orderName}>{state.product.name}</div>
              <div style={s.orderPrice}>¥{state.product.price.toLocaleString()}</div>
            </div>
          </div>

          <h3 style={{ ...s.heading, fontSize: 16, marginBottom: 12 }}>Select Test Card</h3>
          <div style={s.cardList}>
            {TEST_CARDS.map(card => (
              <label key={card.pan} style={s.cardOption}>
                <input
                  type="radio"
                  name="card"
                  checked={selectedCard.pan === card.pan}
                  onChange={() => setSelectedCard(card)}
                  style={{ marginRight: 10 }}
                />
                <div>
                  <div style={{ ...s.cardPan, color: card.color }}>
                    •••• •••• •••• {card.pan.slice(-4)}
                  </div>
                  <div style={s.cardLabel}>{card.label}</div>
                </div>
              </label>
            ))}
          </div>

          <button
            style={s.payBtn}
            onClick={() => submitPayment(state.product)}
          >
            Pay ¥{state.product.price.toLocaleString()}
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
          Auth method: <strong>{state.authType}</strong>
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
    gap: 10,
  },
  productEmoji: { fontSize: 48 },
  productName: { fontSize: 15, fontWeight: 600, textAlign: 'center', color: '#333' },
  productPrice: { fontSize: 20, fontWeight: 700, color: '#667eea' },
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
  },
  orderSummary: {
    background: '#fff',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 24,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  orderEmoji: { fontSize: 40 },
  orderName: { fontSize: 16, fontWeight: 600, color: '#333' },
  orderPrice: { fontSize: 20, fontWeight: 700, color: '#667eea', marginTop: 4 },
  cardList: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 },
  cardOption: {
    display: 'flex',
    alignItems: 'center',
    background: '#fff',
    border: '2px solid #e2e8f0',
    borderRadius: 10,
    padding: '12px 14px',
    cursor: 'pointer',
  },
  cardPan: { fontSize: 15, fontWeight: 700, fontFamily: 'monospace' },
  cardLabel: { fontSize: 12, color: '#888', marginTop: 2 },
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
