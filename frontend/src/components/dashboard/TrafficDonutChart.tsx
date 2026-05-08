// ── TrafficDonutChart — attack type breakdown ─────────────────────────────
// frontend/src/components/dashboard/TrafficDonutChart.tsx
//
// Recharts PieChart (donut variant) showing the distribution of traffic
// by attack type. Data comes from useStats().dbStats.byAttackType.
// Updates live with each stats:update broadcast.
// ───────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  Label,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts'
import { useStats } from '@/hooks/useStats'

// ── Colour map ─────────────────────────────────────────────────────────────

const ATTACK_COLORS: Record<string, string> = {
  Normal:   '#22c55e',  // success-500
  DoS:      '#ef4444',  // danger-500
  PortScan: '#f59e0b',  // warning-500
  Unknown:  '#6366f1',  // brand-500
}

const LABEL_MAP: Record<string, string> = {
  Normal:   'Normal',
  DoS:      'DoS Attack',
  PortScan: 'Port Scan',
  Unknown:  'Unknown',
}

// ── Custom tooltip ─────────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean
  payload?: Array<{ name: string; value: number; payload: { pct: string } }>
}

function ChartTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  const item = payload[0]

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs font-medium text-white">{item.name}</p>
      <p className="text-xs text-slate-400">
        {item.value.toLocaleString()} events ({item.payload.pct})
      </p>
    </div>
  )
}

// ── Custom legend ──────────────────────────────────────────────────────────

interface LegendEntry {
  value: string
  color: string
  payload?: { value: number; pct: string }
}

function ChartLegend({ payload }: { payload?: LegendEntry[] }) {
  if (!payload) return null

  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
      {payload.map((entry) => (
        <div key={entry.value} className="flex items-center gap-1.5 text-xs">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-slate-400">{entry.value}</span>
          {entry.payload && (
            <span className="text-slate-500 font-mono text-[11px]">
              {entry.payload.pct}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function DonutSkeleton() {
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-card p-5 h-[340px]">
      <div className="h-4 w-36 bg-surface-700/60 rounded mb-4 animate-pulse" />
      <div className="flex items-center justify-center h-[250px]">
        <div className="w-40 h-40 rounded-full border-[16px] border-surface-700/40 animate-pulse" />
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Format large numbers with K/M suffixes for the center label */
function formatTotal(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

// ── Component ──────────────────────────────────────────────────────────────

export default function TrafficDonutChart() {
  const { dbStats, isLoading } = useStats()

  const chartData = useMemo(() => {
    const byType = dbStats.byAttackType
    const total = Object.values(byType).reduce((sum, v) => sum + v, 0) || 1

    // Ensure all categories exist, even with 0
    const categories = ['Normal', 'DoS', 'PortScan', 'Unknown'] as const
    return categories
      .map((key) => ({
        name: LABEL_MAP[key] ?? key,
        value: byType[key] ?? 0,
        color: ATTACK_COLORS[key] ?? '#6366f1',
        pct: `${(((byType[key] ?? 0) / total) * 100).toFixed(1)}%`,
      }))
      .filter((d) => d.value > 0) // hide empty slices
  }, [dbStats.byAttackType])

  const totalEvents = useMemo(
    () => Object.values(dbStats.byAttackType).reduce((sum, v) => sum + v, 0),
    [dbStats.byAttackType],
  )

  if (isLoading) return <DonutSkeleton />

  const hasData = chartData.length > 0

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-card p-5 h-[340px] flex flex-col">
      <h3 className="text-sm font-medium text-white mb-2">Attack Distribution</h3>

      {!hasData ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-slate-500">No traffic data yet</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="45%"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
                dataKey="value"
                stroke="none"
                animationBegin={0}
                animationDuration={800}
                animationEasing="ease-out"
              >
                {chartData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={entry.color}
                    className="transition-opacity duration-200 hover:opacity-80"
                  />
                ))}
                {/* Center label inside the donut hole */}
                <Label
                  position="center"
                  content={({ viewBox }) => {
                    const vb = viewBox as { cx?: number; cy?: number } | undefined
                    const cx = vb?.cx ?? 0
                    const cy = vb?.cy ?? 0
                    return (
                      <g>
                        <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="central" fill="#ffffff" style={{ fontSize: '20px', fontWeight: 600 }}>
                          {formatTotal(totalEvents)}
                        </text>
                        <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="central" fill="#64748b" style={{ fontSize: '11px' }}>
                          Total Events
                        </text>
                      </g>
                    )
                  }}
                />
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend content={<ChartLegend />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
