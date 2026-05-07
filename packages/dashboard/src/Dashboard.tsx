import React, { useEffect, useState, useCallback } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, ResponsiveContainer,
} from 'recharts'

interface Metrics {
  totalTransactions: number
  frictionlessRate: number
  challengeCompletionRate: number
  passkeyUsageRate: number
  passkeyEnrollmentRate: number
  avgAuthTimeMs: { otp: number; passkey: number }
  authTypeBreakdown: { FRICTIONLESS: number; OTP: number; PASSKEY: number; PASSKEY_SPC: number }
}

interface Transaction {
  id: string
  acsTransId: string
  merchantName: string | null
  purchaseAmount: number
  authType: string
  authResult: string
  frictionless: boolean
  requestedAt: string
  authenticatedAt: string | null
  durationMs: number | null
}

interface TimeseriesPoint {
  time: string
  total: number
  frictionless: number
  frictionlessRate: number
}

const AUTH_COLORS: Record<string, string> = {
  FRICTIONLESS: '#48bb78',
  OTP: '#ed8936',
  PASSKEY: '#667eea',
  PASSKEY_SPC: '#9f7aea',
}

const RESULT_COLORS: Record<string, string> = {
  AUTHENTICATED: '#48bb78',
  NOT_AUTHENTICATED: '#e53e3e',
  ATTEMPTED: '#ed8936',
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

function ms(n: number) {
  return n > 0 ? `${n.toLocaleString()} ms` : '—'
}

export function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const fetchAll = useCallback(async () => {
    try {
      const [mRes, tRes, tsRes] = await Promise.all([
        fetch('/admin/metrics'),
        fetch('/admin/transactions?limit=20'),
        fetch('/admin/timeseries'),
      ])
      const [m, t, ts] = await Promise.all([mRes.json(), tRes.json(), tsRes.json()])
      setMetrics(m)
      setTransactions(t.transactions ?? [])
      setTimeseries(ts.data ?? [])
      setLastRefresh(new Date())
    } catch {
      // サーバー未起動時はスキップ
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, 10000)
    return () => clearInterval(id)
  }, [fetchAll])

  const pieData = metrics
    ? Object.entries(metrics.authTypeBreakdown)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => ({ name: k, value: v }))
    : []

  const barData = metrics
    ? [
        { name: 'OTP', ms: metrics.avgAuthTimeMs.otp, fill: '#ed8936' },
        { name: 'Passkey', ms: metrics.avgAuthTimeMs.passkey, fill: '#667eea' },
      ]
    : []

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.logo}>🔐</span>
          <div>
            <div style={s.title}>3DS Passkey Admin</div>
            <div style={s.subtitle}>最終更新: {lastRefresh.toLocaleTimeString('ja-JP')}</div>
          </div>
        </div>
        <button style={s.refreshBtn} onClick={fetchAll}>↻ 更新</button>
      </header>

      <main style={s.main}>
        {loading && <p style={s.loadingText}>データ読み込み中...</p>}

        {metrics && (
          <>
            {/* KPI カード */}
            <div style={s.kpiGrid}>
              <KpiCard
                label="総トランザクション"
                value={metrics.totalTransactions.toLocaleString()}
                icon="📊"
                color="#667eea"
              />
              <KpiCard
                label="frictionless 率"
                value={pct(metrics.frictionlessRate)}
                icon="⚡"
                color="#48bb78"
              />
              <KpiCard
                label="チャレンジ完了率"
                value={pct(metrics.challengeCompletionRate)}
                icon="✓"
                color="#ed8936"
              />
              <KpiCard
                label="Passkey 利用率"
                value={pct(metrics.passkeyUsageRate)}
                icon="🔑"
                color="#9f7aea"
              />
              <KpiCard
                label="Passkey 登録率"
                value={pct(metrics.passkeyEnrollmentRate)}
                icon="📱"
                color="#38b2ac"
              />
              <KpiCard
                label="OTP 平均認証時間"
                value={ms(metrics.avgAuthTimeMs.otp)}
                icon="⏱️"
                color="#e53e3e"
              />
            </div>

            {/* チャートセクション */}
            <div style={s.chartGrid}>
              {/* 認証タイプ円グラフ */}
              <div style={s.chartCard}>
                <h3 style={s.chartTitle}>認証タイプ内訳</h3>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, percent }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                      >
                        {pieData.map(entry => (
                          <Cell key={entry.name} fill={AUTH_COLORS[entry.name] || '#888'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => [v, '件数']} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState />
                )}
              </div>

              {/* 平均認証時間棒グラフ */}
              <div style={s.chartCard}>
                <h3 style={s.chartTitle}>平均認証時間（OTP vs Passkey）</h3>
                {barData.some(b => b.ms > 0) ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={barData} barSize={48}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="name" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" tickFormatter={v => `${v}ms`} />
                      <Tooltip formatter={(v: number) => [`${v} ms`, '平均時間']} />
                      <Bar dataKey="ms" radius={[6, 6, 0, 0]}>
                        {barData.map(entry => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState />
                )}
              </div>

              {/* frictionless 率時系列 */}
              <div style={{ ...s.chartCard, gridColumn: '1 / -1' }}>
                <h3 style={s.chartTitle}>frictionless 率（時系列）</h3>
                {timeseries.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={timeseries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="time"
                        stroke="#94a3b8"
                        tickFormatter={v => new Date(v).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                      />
                      <YAxis stroke="#94a3b8" tickFormatter={v => `${(v * 100).toFixed(0)}%`} domain={[0, 1]} />
                      <Tooltip
                        formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, 'frictionless率']}
                        labelFormatter={v => new Date(v).toLocaleString('ja-JP')}
                      />
                      <Line
                        type="monotone"
                        dataKey="frictionlessRate"
                        stroke="#48bb78"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState />
                )}
              </div>
            </div>
          </>
        )}

        {/* トランザクション一覧 */}
        <div style={s.tableCard}>
          <h3 style={s.chartTitle}>最新トランザクション</h3>
          {transactions.length === 0 ? (
            <EmptyState message="まだトランザクションがありません。加盟店ページから購入を試してください。" />
          ) : (
            <div style={s.tableWrapper}>
              <table style={s.table}>
                <thead>
                  <tr>
                    {['時刻', '加盟店', '金額', '認証タイプ', '結果', '所要時間'].map(h => (
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => (
                    <tr key={tx.id} style={s.tr}>
                      <td style={s.td}>
                        {new Date(tx.requestedAt).toLocaleTimeString('ja-JP')}
                      </td>
                      <td style={s.td}>{tx.merchantName ?? '—'}</td>
                      <td style={s.td}>¥{tx.purchaseAmount.toLocaleString()}</td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, background: AUTH_COLORS[tx.authType] || '#888' }}>
                          {tx.authType}
                        </span>
                      </td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, background: RESULT_COLORS[tx.authResult] || '#888' }}>
                          {tx.authResult}
                        </span>
                      </td>
                      <td style={s.td}>
                        {tx.durationMs != null ? `${tx.durationMs.toLocaleString()} ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function KpiCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <div style={{ ...s.kpiCard, borderTop: `3px solid ${color}` }}>
      <div style={s.kpiIcon}>{icon}</div>
      <div style={s.kpiValue}>{value}</div>
      <div style={s.kpiLabel}>{label}</div>
    </div>
  )
}

function EmptyState({ message = 'データなし' }: { message?: string }) {
  return (
    <div style={s.emptyState}>
      <span style={s.emptyIcon}>📭</span>
      <p style={s.emptyText}>{message}</p>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' },
  header: {
    background: '#1e293b',
    borderBottom: '1px solid #334155',
    padding: '16px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  logo: { fontSize: 28 },
  title: { fontSize: 18, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  refreshBtn: {
    background: '#334155',
    color: '#94a3b8',
    border: 'none',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 14,
    cursor: 'pointer',
  },
  main: { padding: '24px' },
  loadingText: { textAlign: 'center', color: '#64748b', padding: 40 },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 16,
    marginBottom: 24,
  },
  kpiCard: {
    background: '#1e293b',
    borderRadius: 12,
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  kpiIcon: { fontSize: 24, marginBottom: 4 },
  kpiValue: { fontSize: 24, fontWeight: 700, color: '#f1f5f9' },
  kpiLabel: { fontSize: 12, color: '#64748b' },
  chartGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: 16,
    marginBottom: 24,
  },
  chartCard: {
    background: '#1e293b',
    borderRadius: 12,
    padding: '20px',
  },
  chartTitle: { fontSize: 15, fontWeight: 600, color: '#cbd5e1', marginBottom: 16 },
  tableCard: {
    background: '#1e293b',
    borderRadius: 12,
    padding: '20px',
    overflowX: 'auto',
  },
  tableWrapper: { overflowX: 'auto', marginTop: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left',
    color: '#64748b',
    fontWeight: 600,
    padding: '8px 12px',
    borderBottom: '1px solid #334155',
    whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid #1e293b' },
  td: { padding: '10px 12px', color: '#cbd5e1', whiteSpace: 'nowrap' },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    color: '#fff',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '40px 0',
  },
  emptyIcon: { fontSize: 32 },
  emptyText: { fontSize: 13, color: '#475569', textAlign: 'center', maxWidth: 280 },
}
