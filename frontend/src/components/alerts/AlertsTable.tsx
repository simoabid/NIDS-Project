// ── AlertsTable — reusable alert data table ───────────────────────────────
// frontend/src/components/alerts/AlertsTable.tsx
//
// Renders a table of Alert objects with configurable density:
//
//   - `compact` mode (dashboard overview): fewer columns, no IP details
//   - Full mode (AlertsPage): all columns including Source/Dest IP
//
// Columns: Timestamp, Source IP, Dest IP, Attack Type, Confidence, Severity
//
// Design notes (from Stitch exploration):
//   - Severity left-border on each row for instant visual scanning
//   - JetBrains Mono (font-mono) for IP addresses
//   - Confidence rendered as a tiny progress bar + number
//   - Pulsing dot for alerts received < 30 seconds ago
//   - Alternating row tinting (transparent / surface-700/10)
// ───────────────────────────────────────────────────────────────────────────

import {
  ShieldAlert,
  ShieldCheck,
  Radar,
  HelpCircle,
} from 'lucide-react'
import type { Alert } from '@/hooks/useAlerts'

// ── Types ──────────────────────────────────────────────────────────────────

interface AlertsTableProps {
  alerts: Alert[]
  /** Compact mode hides IP columns for dashboard preview */
  compact?: boolean
  /** Loading skeleton row count */
  isLoading?: boolean
}

// ── Severity config ────────────────────────────────────────────────────────

interface SeverityConfig {
  className: string
  label: string
  icon: React.ReactNode
  borderColor: string
  barColor: string
}

const SEVERITY: Record<string, SeverityConfig> = {
  critical: {
    className: 'bg-danger-500/10 text-danger-500 border-danger-500/20',
    label: 'Critical',
    icon: <ShieldAlert className="h-3 w-3" />,
    borderColor: '#ef4444',
    barColor: '#ef4444',
  },
  high: {
    className: 'bg-warning-500/10 text-warning-500 border-warning-500/20',
    label: 'High',
    icon: <Radar className="h-3 w-3" />,
    borderColor: '#f59e0b',
    barColor: '#f59e0b',
  },
  medium: {
    className: 'bg-brand-500/10 text-brand-500 border-brand-500/20',
    label: 'Medium',
    icon: <HelpCircle className="h-3 w-3" />,
    borderColor: '#6366f1',
    barColor: '#6366f1',
  },
  low: {
    className: 'bg-success-500/10 text-success-500 border-success-500/20',
    label: 'Normal',
    icon: <ShieldCheck className="h-3 w-3" />,
    borderColor: '#22c55e',
    barColor: '#22c55e',
  },
  info: {
    className: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    label: 'Info',
    icon: <HelpCircle className="h-3 w-3" />,
    borderColor: '#64748b',
    barColor: '#64748b',
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Relative time for display, full ISO for tooltip */
function formatTime(iso: string): { relative: string; full: string } {
  const date = new Date(iso)
  const now = Date.now()
  const diffSec = Math.floor((now - date.getTime()) / 1_000)

  let relative: string
  if (diffSec < 60) relative = `${diffSec}s ago`
  else if (diffSec < 3_600) relative = `${Math.floor(diffSec / 60)}m ago`
  else if (diffSec < 86_400) relative = `${Math.floor(diffSec / 3_600)}h ago`
  else relative = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return { relative, full: date.toLocaleString() }
}

/** Attack type colour classes */
const ATTACK_COLOR: Record<string, string> = {
  Normal:   'text-success-500',
  DoS:      'text-danger-500',
  PortScan: 'text-warning-500',
  Unknown:  'text-brand-500',
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function SkeletonRow({ compact }: { compact: boolean }) {
  return (
    <tr className="border-b border-surface-700/50">
      <td className="px-4 py-3"><div className="h-3 w-16 bg-surface-700/50 rounded animate-pulse" /></td>
      {!compact && (
        <>
          <td className="px-4 py-3"><div className="h-3 w-24 bg-surface-700/50 rounded animate-pulse" /></td>
          <td className="px-4 py-3"><div className="h-3 w-24 bg-surface-700/50 rounded animate-pulse" /></td>
        </>
      )}
      <td className="px-4 py-3"><div className="h-3 w-16 bg-surface-700/50 rounded animate-pulse" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-surface-700/50 rounded animate-pulse" /></td>
      <td className="px-4 py-3"><div className="h-5 w-16 bg-surface-700/50 rounded-full animate-pulse" /></td>
    </tr>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <tr>
      <td colSpan={6} className="py-16 text-center">
        <ShieldCheck className="h-10 w-10 text-slate-600 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-400">No alerts found</p>
        <p className="text-xs text-slate-600 mt-1">Try adjusting your filters or wait for new data</p>
      </td>
    </tr>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AlertsTable({ alerts, compact = false, isLoading = false }: AlertsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <thead className="sticky top-0 z-10 bg-surface-800">
          <tr className="border-b border-surface-700">
            <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Timestamp
            </th>
            {!compact && (
              <>
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Source IP
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Destination IP
                </th>
              </>
            )}
            <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Attack Type
            </th>
            <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Confidence
            </th>
            <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Severity
            </th>
          </tr>
        </thead>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <tbody>
          {isLoading ? (
            Array.from({ length: compact ? 5 : 10 }).map((_, i) => (
              <SkeletonRow key={i} compact={compact} />
            ))
          ) : alerts.length === 0 ? (
            <EmptyState />
          ) : (
            alerts.map((alert, i) => {
              const sev = SEVERITY[alert.severity] ?? SEVERITY['info']
              const time = formatTime(alert.timestamp)
              const isNew = (Date.now() - new Date(alert.timestamp).getTime()) < 30_000
              const confidencePct = Math.round(alert.confidence * 100)
              const stripeBg = i % 2 === 0 ? '' : 'bg-surface-700/5'

              return (
                <tr
                  key={alert.id}
                  className={`border-b border-surface-700/30 hover:bg-surface-700/20 transition-colors ${stripeBg}`}
                  style={{ borderLeft: `3px solid ${sev.borderColor}` }}
                >
                  {/* Timestamp */}
                  <td className="px-4 py-2.5" title={time.full}>
                    <div className="flex items-center gap-2">
                      {isNew && (
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-75 animate-ping" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
                        </span>
                      )}
                      <span className="text-xs text-slate-400">{time.relative}</span>
                    </div>
                  </td>

                  {/* Source IP */}
                  {!compact && (
                    <td className="px-4 py-2.5">
                      <span className="text-sm font-mono text-white">{alert.sourceIp}</span>
                    </td>
                  )}

                  {/* Destination IP */}
                  {!compact && (
                    <td className="px-4 py-2.5">
                      <span className="text-sm font-mono text-slate-400">{alert.destinationIp}</span>
                    </td>
                  )}

                  {/* Attack Type */}
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold ${ATTACK_COLOR[alert.attackType] ?? 'text-slate-400'}`}>
                      {alert.attackType}
                    </span>
                  </td>

                  {/* Confidence */}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-surface-700/40 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${confidencePct}%`,
                            backgroundColor: sev.barColor,
                          }}
                        />
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 min-w-[32px]">
                        {confidencePct}%
                      </span>
                    </div>
                  </td>

                  {/* Severity badge */}
                  <td className="px-4 py-2.5">
                    <div className={`inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full border ${sev.className}`}>
                      {sev.icon}
                      {sev.label}
                    </div>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
