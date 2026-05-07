import { prisma } from '../prisma'

export async function getMetrics(from: Date, to: Date) {
  const transactions = await prisma.transaction.findMany({
    where: { requestedAt: { gte: from, lte: to } },
  })

  const total = transactions.length
  if (total === 0) {
    return {
      totalTransactions: 0,
      frictionlessRate: 0,
      challengeCompletionRate: 0,
      passkeyUsageRate: 0,
      passkeyEnrollmentRate: 0,
      avgAuthTimeMs: { otp: 0, passkey: 0 },
      authTypeBreakdown: { FRICTIONLESS: 0, OTP: 0, PASSKEY: 0, PASSKEY_SPC: 0 },
    }
  }

  const frictionless = transactions.filter(t => t.frictionless).length
  const challenged = transactions.filter(t => !t.frictionless)
  const completed = challenged.filter(t => t.authResult === 'AUTHENTICATED')

  // Passkey認証（最終的にPasskeyで完了したトランザクション）
  const passkeyTx = transactions.filter(t => t.authType === 'PASSKEY' || t.authType === 'PASSKEY_SPC')

  // OTP平均認証時間: otpCompletedAt が記録されているトランザクションで計算
  // (OTP検証 → Passkey登録へ移行した場合も otpCompletedAt が正確な完了時刻)
  const otpTimedTx = transactions.filter(t => t.challengeStartedAt && t.otpCompletedAt)
  const otpAvgMs = otpTimedTx.length > 0
    ? Math.round(
        otpTimedTx.reduce(
          (acc, t) => acc + (t.otpCompletedAt!.getTime() - t.challengeStartedAt!.getTime()),
          0
        ) / otpTimedTx.length
      )
    : 0

  // Passkey平均認証時間: 最初からPasskeyチャレンジだったトランザクション（enroll経由でなく）
  const passkeyAuthTx = passkeyTx.filter(
    t => t.challengeStartedAt && t.authenticatedAt && !t.enrolledPasskey
  )
  const passkeyAvgMs = passkeyAuthTx.length > 0
    ? Math.round(
        passkeyAuthTx.reduce(
          (acc, t) => acc + (t.authenticatedAt!.getTime() - t.challengeStartedAt!.getTime()),
          0
        ) / passkeyAuthTx.length
      )
    : 0

  // Passkey登録率: OTPを成功させた人のうちPasskeyを登録した割合
  // otpCompletedAt が存在 = OTP検証済み
  const otpCompletedCount = transactions.filter(t => t.otpCompletedAt !== null).length
  const enrolledCount = transactions.filter(t => t.enrolledPasskey).length
  const passkeyEnrollmentRate = otpCompletedCount > 0 ? enrolledCount / otpCompletedCount : 0

  // 認証方式内訳（最終的なauthType）
  const authTypeBreakdown = {
    FRICTIONLESS: transactions.filter(t => t.authType === 'FRICTIONLESS').length,
    OTP: transactions.filter(t => t.authType === 'OTP' && t.authResult === 'AUTHENTICATED').length,
    PASSKEY: transactions.filter(t => t.authType === 'PASSKEY').length,
    PASSKEY_SPC: transactions.filter(t => t.authType === 'PASSKEY_SPC').length,
  }

  return {
    totalTransactions: total,
    frictionlessRate: frictionless / total,
    challengeCompletionRate: challenged.length > 0 ? completed.length / challenged.length : 0,
    passkeyUsageRate: challenged.length > 0 ? passkeyTx.length / challenged.length : 0,
    passkeyEnrollmentRate,
    avgAuthTimeMs: {
      otp: otpAvgMs,
      passkey: passkeyAvgMs,
    },
    authTypeBreakdown,
  }
}
