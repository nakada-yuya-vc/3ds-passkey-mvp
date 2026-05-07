import { prisma } from '../prisma'
import { randomInt } from 'crypto'

const OTP_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MOCK_OTP = '123456'

export async function generateOtp(acsTransId: string): Promise<string> {
  const otpCode = process.env.OTP_MOCK === 'true'
    ? MOCK_OTP
    : String(randomInt(100000, 999999))

  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await prisma.otpSession.upsert({
    where: { acsTransId },
    update: { otpCode, expiresAt, verified: false },
    create: { acsTransId, otpCode, expiresAt },
  })

  if (process.env.OTP_MOCK === 'true') {
    console.log(`[OTP MOCK] acsTransId=${acsTransId} code=${otpCode}`)
  }

  return otpCode
}

export async function verifyOtp(acsTransId: string, code: string): Promise<boolean> {
  const session = await prisma.otpSession.findUnique({ where: { acsTransId } })
  if (!session) return false
  if (session.verified) return false
  if (new Date() > session.expiresAt) return false
  if (session.otpCode !== code) return false

  await prisma.otpSession.update({
    where: { acsTransId },
    data: { verified: true },
  })

  return true
}
