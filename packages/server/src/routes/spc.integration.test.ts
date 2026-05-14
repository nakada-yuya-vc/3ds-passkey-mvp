import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spcRoutes } from './spc'
import { threedsRoutes } from './threeds'
import { buildSpcDisplayData } from '../services/spc-display'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    transaction: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    spcAuthenticationAudit: {
      create: vi.fn(),
    },
    otpSession: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock('../prisma', () => ({ prisma: prismaMock }))

function makeApp() {
  const app = Fastify({ logger: false })
  app.register(spcRoutes, { prefix: '/spc' })
  app.register(threedsRoutes, { prefix: '/threeds' })
  return app
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function transactionWithCredential() {
  return {
    acsTransId: 'acs-123',
    purchaseCurrency: '392',
    purchaseAmount: 24800,
    merchantName: 'Test Shop',
    user: {
      credentials: [
        {
          credentialId: 'credential-1',
          spcCapable: false,
          transports: ['internal'],
          aaguid: '08987058-cadc-4b81-b6e1-30de50dcbe96',
          publicKey: Buffer.from('not-used-in-this-test'),
          signCount: 0,
        },
      ],
    },
  }
}

describe('SPC route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RP_ID = 'localhost'
    process.env.RP_ORIGIN = 'http://localhost:3004'
    process.env.SPC_PAYEE_ORIGIN = 'https://merchant.example.com'
  })

  it('issues SPC options and records the expected payment data in audit log', async () => {
    prismaMock.transaction.findUnique.mockResolvedValue(transactionWithCredential())
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        challengeSession: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ id: 'challenge-1' }),
        },
      }),
    )
    prismaMock.spcAuthenticationAudit.create.mockResolvedValue({ id: 'audit-1' })

    const app = makeApp()
    const response = await app.inject({
      method: 'GET',
      url: '/spc/options?acsTransId=acs-123',
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body).toMatchObject({
      rpId: 'localhost',
      payeeOrigin: 'https://merchant.example.com',
      merchantName: 'Test Shop',
      total: { currency: 'JPY', value: '24800' },
      amount: 24800,
      currencyNumeric: '392',
    })
    expect(body.challenge).toEqual(expect.any(String))
    expect(body.credentials).toEqual([
      {
        credentialId: 'credential-1',
        spcCapable: false,
        transports: ['internal'],
      },
    ])
    expect(prismaMock.spcAuthenticationAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acsTransId: 'acs-123',
        event: 'OPTIONS_ISSUED',
        expectedPayment: expect.objectContaining({
          rpId: 'localhost',
          payeeOrigin: 'https://merchant.example.com',
          total: { value: '24800', currency: 'JPY' },
        }),
      }),
    })
  })

  it('rejects SPC assertions whose signed payment total differs from the issued transaction', async () => {
    prismaMock.transaction.findUnique.mockResolvedValue(transactionWithCredential())
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        challengeSession: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'challenge-1',
            challenge: 'expected-challenge',
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }),
    )
    prismaMock.spcAuthenticationAudit.create.mockResolvedValue({ id: 'audit-1' })

    const displayData = buildSpcDisplayData('Test Shop')
    const assertion = {
      id: 'credential-1',
      response: {
        clientDataJSON: b64urlJson({
          type: 'payment.get',
          challenge: 'expected-challenge',
          origin: 'http://localhost:3004',
          payment: {
            rpId: 'localhost',
            topOrigin: 'https://merchant.example.com',
            payeeOrigin: 'https://merchant.example.com',
            total: { value: '99999', currency: 'JPY' },
            instrument: displayData.instrument,
          },
        }),
      },
    }

    const app = makeApp()
    const response = await app.inject({
      method: 'POST',
      url: '/spc/verify',
      payload: { acsTransId: 'acs-123', assertion },
    })
    await app.close()

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      error: 'Dynamic linking mismatch',
      reason: 'DYNAMIC_LINKING_MISMATCH',
    })
    expect(prismaMock.spcAuthenticationAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acsTransId: 'acs-123',
        event: 'VERIFY_FAILED',
        failureReason: 'DYNAMIC_LINKING_MISMATCH',
        credentialIdHash: expect.any(String),
        receivedPayment: expect.objectContaining({
          payeeOrigin: 'https://merchant.example.com',
          total: { value: '99999', currency: 'JPY' },
        }),
      }),
    })
  })

  it('records client-side SPC fallback when the flow switches to OTP', async () => {
    prismaMock.transaction.findUnique.mockResolvedValue({
      acsTransId: 'acs-123',
      authResult: 'ATTEMPTED',
      authType: 'PASSKEY_SPC',
      challengeStartedAt: null,
    })
    prismaMock.otpSession.upsert.mockResolvedValue({ id: 'otp-1' })
    prismaMock.transaction.update.mockResolvedValue({ acsTransId: 'acs-123' })
    prismaMock.spcAuthenticationAudit.create.mockResolvedValue({ id: 'audit-1' })

    const app = makeApp()
    const response = await app.inject({
      method: 'POST',
      url: '/threeds/fallback/otp',
      payload: { acsTransID: 'acs-123', reason: 'spc_unavailable' },
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'otp_required' })
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { acsTransId: 'acs-123' },
      data: expect.objectContaining({
        authType: 'OTP',
        authResult: 'ATTEMPTED',
      }),
    })
    expect(prismaMock.spcAuthenticationAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acsTransId: 'acs-123',
        event: 'FALLBACK_TO_OTP',
        failureReason: 'CLIENT_SPC_UNAVAILABLE',
        detail: 'spc_unavailable; previousAuthType=PASSKEY_SPC',
      }),
    })
  })
})
