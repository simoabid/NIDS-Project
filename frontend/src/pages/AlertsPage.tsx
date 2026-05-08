// ── AlertsPage — full paginated alert history ─────────────────────────────
// frontend/src/pages/AlertsPage.tsx
//
// Shows the full AlertsTable with:
//   - Attack type filter dropdown
//   - Severity filter dropdown
//   - Pagination controls (prev/next + page numbers)
//   - Live alert prepending via useAlerts()
//
// Design based on Stitch exploration: dark luxury, JetBrains Mono for IPs,
// ghost-style pagination, indigo active page, filter selects with dark bg.
// ───────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useCallback } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Radio,
} from 'lucide-react'
import AlertsTable from '@/components/alerts/AlertsTable'
import { useAlerts } from '@/hooks/useAlerts'
import type { AlertFilters } from '@/hooks/useAlerts'

// ── Filter options ─────────────────────────────────────────────────────────

const ATTACK_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'Normal', label: 'Normal' },
  { value: 'DoS', label: 'DoS' },
  { value: 'PortScan', label: 'Port Scan' },
  { value: 'Unknown', label: 'Unknown' },
] as const

const SEVERITIES = [
  { value: '', label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
] as const

// ── Select component ───────────────────────────────────────────────────────

interface FilterSelectProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
}

function FilterSelect({ id, label, value, onChange, options }: FilterSelectProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-900 border border-surface-700 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors appearance-none cursor-pointer min-w-[140px]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// ── Pagination helpers ─────────────────────────────────────────────────────

/** Generate an array of page numbers with ellipsis */
function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const pages: (number | '...')[] = [1]

  if (current > 3) pages.push('...')

  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  for (let i = start; i <= end; i++) pages.push(i)

  if (current < total - 2) pages.push('...')

  pages.push(total)
  return pages
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AlertsPage() {
  // Filter state
  const [attackType, setAttackType] = useState('')
  const [severity, setSeverity] = useState('')

  const filters: AlertFilters = useMemo(() => {
    const f: AlertFilters = {}
    if (attackType) f.attackType = attackType as AlertFilters['attackType']
    if (severity) f.severity = severity as AlertFilters['severity']
    return f
  }, [attackType, severity])

  const { alerts, isLoading, pagination, fetchPage } = useAlerts(filters)

  const handlePageChange = useCallback(
    (page: number) => {
      if (page >= 1 && page <= pagination.pages) {
        void fetchPage(page)
      }
    },
    [fetchPage, pagination.pages],
  )

  // Pagination range text
  const rangeStart = (pagination.page - 1) * pagination.limit + 1
  const rangeEnd = Math.min(pagination.page * pagination.limit, pagination.total)

  return (
    <div className="animate-fade-in-up space-y-5">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Alert Feed</h1>
          <p className="text-sm text-slate-400">Real-time network threat detection stream</p>
        </div>

        {/* Live indicator */}
        <div className="flex items-center gap-2 shrink-0">
          <Radio className="h-3.5 w-3.5 text-success-500" />
          <span className="text-xs text-slate-400">
            <span className="relative flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-success-500 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success-500" />
              </span>
              Live
            </span>
          </span>
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 bg-surface-800 border border-surface-700 rounded-card px-4 py-3">
        <Filter className="h-4 w-4 text-slate-500 shrink-0" />

        <FilterSelect
          id="filter-attack-type"
          label="Attack Type"
          value={attackType}
          onChange={setAttackType}
          options={ATTACK_TYPES}
        />

        <FilterSelect
          id="filter-severity"
          label="Severity"
          value={severity}
          onChange={setSeverity}
          options={SEVERITIES}
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Count */}
        <p className="text-xs text-slate-500 shrink-0">
          {pagination.total > 0 ? (
            <>
              Showing <span className="text-slate-300 font-mono">{rangeStart}–{rangeEnd}</span> of{' '}
              <span className="text-slate-300 font-mono">{pagination.total.toLocaleString()}</span> alerts
            </>
          ) : (
            'No alerts'
          )}
        </p>
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      <div className="bg-surface-800 border border-surface-700 rounded-card overflow-hidden">
        <AlertsTable alerts={alerts} isLoading={isLoading} />
      </div>

      {/* ── Pagination ───────────────────────────────────────────── */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          {/* Page indicator */}
          <p className="text-xs text-slate-500 hidden sm:block">
            Page <span className="text-slate-300 font-mono">{pagination.page}</span> of{' '}
            <span className="text-slate-300 font-mono">{pagination.pages}</span>
          </p>

          {/* Controls */}
          <div className="flex items-center gap-1 mx-auto sm:mx-0">
            {/* Previous */}
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-400 border border-surface-700 rounded-lg hover:bg-surface-700/30 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>

            {/* Page numbers */}
            {getPageNumbers(pagination.page, pagination.pages).map((page, i) =>
              page === '...' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-xs text-slate-600">
                  …
                </span>
              ) : (
                <button
                  key={page}
                  onClick={() => handlePageChange(page)}
                  className={[
                    'min-w-[32px] h-8 text-xs font-medium rounded-lg transition-colors',
                    page === pagination.page
                      ? 'bg-brand-500 text-white'
                      : 'text-slate-400 hover:bg-surface-700/30 hover:text-white',
                  ].join(' ')}
                >
                  {page}
                </button>
              ),
            )}

            {/* Next */}
            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.pages}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-400 border border-surface-700 rounded-lg hover:bg-surface-700/30 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
