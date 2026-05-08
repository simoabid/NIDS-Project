// ── Dashboard page — fully wired ──────────────────────────────────────────
// frontend/src/pages/DashboardPage.tsx
//
// Assembles all live dashboard components:
//   - AlertBanner   — red/amber strip on critical alerts (auto-dismiss 8s)
//   - StatCards     — 4 metric counters from useStats()
//   - TrafficDonut  — attack distribution pie chart
//   - AlertsTable   — compact last-5 preview (reusable component)
// ──────────────────────────────────────────────────────────────────────────────

import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

import StatCards from '@/components/dashboard/StatCards'
import TrafficDonutChart from '@/components/dashboard/TrafficDonutChart'
import AlertBanner from '@/components/dashboard/AlertBanner'
import AlertsTable from '@/components/alerts/AlertsTable'
import { useAlerts } from '@/hooks/useAlerts'
import { useStats } from '@/hooks/useStats'

// ── Severity config for the Threat Summary chart ───────────────────────────

const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low'] as const

const SEVERITY_CONFIG: Record<string, { label: string; bar: string; className: string }> = {
  critical: { label: 'Critical', bar: '#ef4444', className: 'bg-danger-500/10 text-danger-500 border-danger-500/20' },
  high:     { label: 'High',     bar: '#f59e0b', className: 'bg-warning-500/10 text-warning-500 border-warning-500/20' },
  medium:   { label: 'Medium',   bar: '#6366f1', className: 'bg-brand-500/10 text-brand-500 border-brand-500/20' },
  low:      { label: 'Normal',   bar: '#22c55e', className: 'bg-success-500/10 text-success-500 border-success-500/20' },
}

// ── Component ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { alerts, isLoading: alertsLoading } = useAlerts()
  const { liveStats } = useStats()

  // Only show the last 5 alerts in the preview
  const recentAlerts = alerts.slice(0, 5)

  return (
    <div className="animate-fade-in-up space-y-6">
      {/* ── Alert banner (auto-shows on critical events) ──────────── */}
      <AlertBanner />

      {/* ── Page header ───────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Overview</h1>
          <p className="text-sm text-slate-400">
            Real-time network traffic analysis and threat detection
          </p>
        </div>

        {/* Last updated indicator */}
        {liveStats && (
          <p className="text-[11px] text-slate-600 shrink-0 hidden sm:block">
            Live · updated {new Date(liveStats.timestamp).toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* ── Stat cards ────────────────────────────────────────────── */}
      <StatCards />

      {/* ── Charts row ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Donut chart */}
        <TrafficDonutChart />

        {/* Threat Summary — severity breakdown */}
        <div className="bg-surface-800 border border-surface-700 rounded-card p-5 h-[340px] flex flex-col">
          <h3 className="text-sm font-medium text-white mb-4">Threat Summary</h3>
          <div className="flex-1 flex flex-col justify-center gap-3">
            {SEVERITY_LEVELS.map((severity) => {
              const config = SEVERITY_CONFIG[severity]
              const count = alerts.filter((a) => a.severity === severity).length

              return (
                <div key={severity} className="flex items-center gap-3">
                  <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${config.className} min-w-[80px]`}>
                    {config.label}
                  </div>
                  {/* Bar */}
                  <div className="flex-1 h-2 bg-surface-700/40 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{
                        width: alerts.length > 0
                          ? `${Math.max((count / alerts.length) * 100, count > 0 ? 2 : 0)}%`
                          : '0%',
                        backgroundColor: config.bar,
                      }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 font-mono w-8 text-right">
                    {count}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Recent alerts — compact table ───────────────────────── */}
      <div className="bg-surface-800 border border-surface-700 rounded-card overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="text-sm font-medium text-white">Recent Alerts</h3>
          <Link
            to="/alerts"
            className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-100 transition-colors"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <AlertsTable alerts={recentAlerts} compact isLoading={alertsLoading} />
      </div>
    </div>
  )
}
