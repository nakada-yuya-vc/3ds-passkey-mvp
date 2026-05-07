import { FastifyInstance } from 'fastify'
import { prisma } from '../prisma'
import { getMetrics } from '../services/metrics'

export async function adminRoutes(server: FastifyInstance) {
  // GET /admin/metrics
  server.get<{
    Querystring: { from?: string; to?: string }
  }>('/metrics', async (request, reply) => {
    const now = new Date()
    const from = request.query.from
      ? new Date(request.query.from)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
    const to = request.query.to ? new Date(request.query.to) : now

    const metrics = await getMetrics(from, to)
    return metrics
  })

  // GET /admin/transactions - 最新トランザクション一覧
  server.get<{
    Querystring: { limit?: string; offset?: string }
  }>('/transactions', async (request, reply) => {
    const limit = Math.min(Number(request.query.limit) || 20, 100)
    const offset = Number(request.query.offset) || 0

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        orderBy: { requestedAt: 'desc' },
        take: limit,
        skip: offset,
        include: { user: true },
      }),
      prisma.transaction.count(),
    ])

    return {
      total,
      transactions: transactions.map(t => ({
        id: t.id,
        acsTransId: t.acsTransId,
        merchantName: t.merchantName,
        purchaseAmount: t.purchaseAmount,
        authType: t.authType,
        authResult: t.authResult,
        frictionless: t.frictionless,
        requestedAt: t.requestedAt,
        authenticatedAt: t.authenticatedAt,
        durationMs: t.challengeStartedAt && t.authenticatedAt
          ? t.authenticatedAt.getTime() - t.challengeStartedAt.getTime()
          : null,
      })),
    }
  })

  // GET /admin/timeseries - 時系列データ
  server.get<{
    Querystring: { from?: string; to?: string; interval?: string }
  }>('/timeseries', async (request, reply) => {
    const now = new Date()
    const from = request.query.from
      ? new Date(request.query.from)
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const to = request.query.to ? new Date(request.query.to) : now

    const transactions = await prisma.transaction.findMany({
      where: { requestedAt: { gte: from, lte: to } },
      orderBy: { requestedAt: 'asc' },
    })

    // 1時間ごとにグループ化
    const buckets = new Map<string, { total: number; frictionless: number }>()

    for (const tx of transactions) {
      const hour = new Date(tx.requestedAt)
      hour.setMinutes(0, 0, 0)
      const key = hour.toISOString()

      if (!buckets.has(key)) {
        buckets.set(key, { total: 0, frictionless: 0 })
      }

      const bucket = buckets.get(key)!
      bucket.total++
      if (tx.frictionless) bucket.frictionless++
    }

    const data = Array.from(buckets.entries()).map(([time, stats]) => ({
      time,
      total: stats.total,
      frictionless: stats.frictionless,
      frictionlessRate: stats.total > 0 ? stats.frictionless / stats.total : 0,
    }))

    return { data }
  })
}
