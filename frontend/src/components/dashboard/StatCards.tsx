// ── StatCards — live dashboard counters ────────────────────────────────────
// frontend/src/components/dashboard/StatCards.tsx
//
// Four metric cards fed by useStats(). Each card displays:
//   - A semantic icon in a coloured container
//   - The primary metric value (formatted with K/M suffixes)
//   - A label
//   - An optional secondary detail
//
// Values update every ~10 s from the stats:update Socket.io event.
// Falls back to aggregated DB stats until the first live broadcast arrives.
// ───────────────────────────────────────────────────────────────────────────

import {
  Activity,
  ShieldAlert,
  Radar,
  TrendingUp,
} from 'lucide-react'
import { useStats } from '@/hooks/useStats'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Format large numbers with K/M suffixes for readability */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

/** Format a percentage to one decimal place */
function formatPct(n: number): string {
  return `${n.toFixed(1)}%`
}

// ── Card config ────────────────────────────────────────────────────────────

interface CardConfig {
  id: string
  label: string
  icon: React.ReactNode
  /** Tailwind colour classes for the icon container */
  iconBg: string
  iconColor: string
  /** Tailwind colour for the value text when emphasised */
  valueColor: string
  /** Extract the display value from stats */
  getValue: (live: LiveData, db: DbData) => string
  /** Optional secondary detail line */
  getDetail?: (live: LiveData, db: DbData) => string
}

interface LiveData {
  totalPackets: number
  normalCount: number
  attackCount: number
  detectionRate: number
  avgConfidence: number
  topAttackType: string
  captureActive: boolean
}

interface DbData {
  total: number
  last24h: number
  byAttackType: Record<string, number>
}

const LIVE_DEFAULTS: LiveData = {
  totalPackets: 0,
  normalCount: 0,
  attackCount: 0,
  detectionRate: 0,
  avgConfidence: 0,
  topAttackType: '—',
  captureActive: false,
}

const CARDS: CardConfig[] = [
  {
    id: 'total-events',
    label: 'Total Events',
    icon: <Activity className="h-[18px] w-[18px]" />,
    iconBg: 'bg-brand-500/10',
    iconColor: 'text-brand-500',
    valueColor: 'text-white',
    getValue: (live, db) => formatCount(live.totalPackets || db.total),
    getDetail: (_live, db) => `${formatCount(db.last24h)} in last 24h`,
  },
  {
    id: 'dos-attacks',
    label: 'DoS Attacks',
    icon: <ShieldAlert className="h-[18px] w-[18px]" />,
    iconBg: 'bg-danger-500/10',
    iconColor: 'text-danger-500',
    valueColor: 'text-danger-500',
    getValue: (_live, db) => formatCount(db.byAttackType['DoS'] ?? 0),
    getDetail: (_live, db) => {
      const total = db.total || 1
      const dos = db.byAttackType['DoS'] ?? 0
      return `${((dos / total) * 100).toFixed(1)}% of traffic`
    },
  },
  {
    id: 'port-scans',
    label: 'Port Scans',
    icon: <Radar className="h-[18px] w-[18px]" />,
    iconBg: 'bg-warning-500/10',
    iconColor: 'text-warning-500',
    valueColor: 'text-warning-500',
    getValue: (_live, db) => formatCount(db.byAttackType['PortScan'] ?? 0),
    getDetail: (_live, db) => {
      const total = db.total || 1
      const scans = db.byAttackType['PortScan'] ?? 0
      return `${((scans / total) * 100).toFixed(1)}% of traffic`
    },
  },
  {
    id: 'detection-rate',
    label: 'Detection Rate',
    icon: <TrendingUp className="h-[18px] w-[18px]" />,
    iconBg: 'bg-success-500/10',
    iconColor: 'text-success-500',
    valueColor: 'text-success-500',
    getValue: (live) => formatPct(live.detectionRate),
    getDetail: (live) => `Avg confidence ${formatPct(live.avgConfidence)}`,
  },
]

// ── Skeleton ───────────────────────────────────────────────────────────────

function StatCardSkeleton() {
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-card p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2.5 flex-1">
          <div className="h-3 w-20 bg-surface-700/60 rounded animate-pulse" />
          <div className="h-7 w-16 bg-surface-700/60 rounded animate-pulse" />
          <div className="h-3 w-28 bg-surface-700/40 rounded animate-pulse" />
        </div>
        <div className="h-9 w-9 rounded-lg bg-surface-700/40 animate-pulse" />
      </div>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function StatCards() {
  const { liveStats, dbStats, isLoading } = useStats()

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {CARDS.map((c) => <StatCardSkeleton key={c.id} />)}
      </div>
    )
  }

  const live: LiveData = liveStats ?? LIVE_DEFAULTS
  const db: DbData = dbStats

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {CARDS.map((card, i) => (
        <div
          key={card.id}
          className="group bg-surface-800 border border-surface-700 hover:border-surface-700/80 rounded-card p-4 transition-all duration-200 hover:shadow-lg hover:shadow-black/10"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1 min-w-0">
              {/* Label */}
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                {card.label}
              </p>

              {/* Value */}
              <p className={`text-2xl font-semibold tracking-tight ${card.valueColor}`}>
                {card.getValue(live, db)}
              </p>

              {/* Detail */}
              {card.getDetail && (
                <p className="text-xs text-slate-500">
                  {card.getDetail(live, db)}
                </p>
              )}
            </div>

            {/* Icon */}
            <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${card.iconBg} ${card.iconColor} shrink-0`}>
              {card.icon}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
