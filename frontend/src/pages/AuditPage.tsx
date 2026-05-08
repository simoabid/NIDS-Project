// ── AuditPage — admin-only activity timeline ──────────────────────────────
// frontend/src/pages/AuditPage.tsx
//
// Fetches GET /api/audit-log on mount (historical, no live updates).
// Renders a vertical timeline of system events, each color-coded by
// action domain (auth, ai, capture, alert, user).
//
// Design from Stitch: forensic timeline aesthetic, domain-colored dots
// and badges, expandable metadata panels, dense but readable layout.
// ───────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Shield,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import api from '@/services/api'

// ── Types ──────────────────────────────────────────────────────────────────

interface AuditEntry {
  _id: string
  actor: string | null
  actorEmail: string | null
  actorRole: 'admin' | 'viewer' | 'system'
  action: string
  targetId: string | null
  targetType: string | null
  metadata: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
}

// ── Action domain config ───────────────────────────────────────────────────

interface DomainStyle {
  dot: string          // dot bg colour
  badge: string        // badge CSS classes
  label: string        // human-readable domain name
}

const DOMAIN_STYLES: Record<string, DomainStyle> = {
  auth: {
    dot:   'bg-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    label: 'Auth',
  },
  ai: {
    dot:   'bg-brand-500',
    badge: 'bg-brand-500/10 text-brand-500 border-brand-500/20',
    label: 'AI',
  },
  capture: {
    dot:   'bg-cyan-500',
    badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    label: 'Capture',
  },
  alert: {
    dot:   'bg-amber-500',
    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    label: 'Alert',
  },
  user: {
    dot:   'bg-purple-500',
    badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    label: 'User',
  },
}

const DEFAULT_STYLE: DomainStyle = {
  dot:   'bg-slate-500',
  badge: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  label: 'System',
}

/** Extract domain from action string: "auth:login" → "auth" */
function getDomain(action: string): string {
  return action.split(':')[0] ?? 'system'
}

function getStyle(action: string): DomainStyle {
  return DOMAIN_STYLES[getDomain(action)] ?? DEFAULT_STYLE
}

// ── Role badge ─────────────────────────────────────────────────────────────

const ROLE_CLASSES: Record<string, string> = {
  admin:  'bg-brand-500/10 text-brand-500 border-brand-500/20',
  viewer: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  system: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(iso: string): { relative: string; full: string } {
  const date = new Date(iso)
  const now = Date.now()
  const diffSec = Math.floor((now - date.getTime()) / 1_000)

  let relative: string
  if (diffSec < 60) relative = `${diffSec}s ago`
  else if (diffSec < 3_600) relative = `${Math.floor(diffSec / 60)}m ago`
  else if (diffSec < 86_400) relative = `${Math.floor(diffSec / 3_600)}h ago`
  else if (diffSec < 604_800) relative = `${Math.floor(diffSec / 86_400)}d ago`
  else relative = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return { relative, full: date.toLocaleString() }
}

// ── Action filter options ──────────────────────────────────────────────────

const ACTION_FILTERS = [
  { value: '', label: 'All Actions' },
  { value: 'auth:login', label: 'auth:login' },
  { value: 'auth:logout', label: 'auth:logout' },
  { value: 'auth:failed_login', label: 'auth:failed_login' },
  { value: 'ai:prediction', label: 'ai:prediction' },
  { value: 'ai:detection', label: 'ai:detection' },
  { value: 'ai:error', label: 'ai:error' },
  { value: 'capture:start', label: 'capture:start' },
  { value: 'capture:stop', label: 'capture:stop' },
  { value: 'capture:upload', label: 'capture:upload' },
  { value: 'alert:acknowledged', label: 'alert:acknowledged' },
  { value: 'alert:resolved', label: 'alert:resolved' },
  { value: 'alert:false_positive', label: 'alert:false_positive' },
  { value: 'user:created', label: 'user:created' },
  { value: 'user:role_changed', label: 'user:role_changed' },
] as const

// ── Timeline entry ─────────────────────────────────────────────────────────

function TimelineEntry({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false)
  const style = getStyle(entry.action)
  const time = formatTime(entry.createdAt)
  const hasMetadata = Object.keys(entry.metadata).length > 0
  const roleClass = ROLE_CLASSES[entry.actorRole] ?? ROLE_CLASSES['system']

  return (
    <div className="relative flex gap-4 pb-6 last:pb-0 group">
      {/* Timeline line */}
      <div className="absolute left-[9px] top-5 bottom-0 w-px bg-surface-700 group-last:hidden" />

      {/* Domain dot */}
      <div className={`relative z-10 mt-1.5 h-[18px] w-[18px] rounded-full border-2 border-surface-800 ${style.dot} shrink-0`} />

      {/* Content card */}
      <div className="flex-1 min-w-0 bg-surface-800 border border-surface-700 rounded-lg px-4 py-3 hover:border-surface-600 transition-colors">
        {/* Top row: action badge + actor + timestamp */}
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          {/* Action badge */}
          <span className={`inline-flex items-center text-[11px] font-mono font-medium px-2 py-0.5 rounded-full border ${style.badge}`}>
            {entry.action}
          </span>

          {/* Actor */}
          <span className="text-xs text-slate-400">
            {entry.actorEmail ?? (entry.actor ? `ID:${entry.actor.slice(0, 8)}` : 'System')}
          </span>

          {/* Role badge */}
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${roleClass}`}>
            {entry.actorRole}
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Timestamp */}
          <span className="text-[11px] text-slate-600 shrink-0" title={time.full}>
            {time.relative}
          </span>
        </div>

        {/* Detail row: target + IP */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {entry.targetType && (
            <span className="text-slate-500">
              <span className="text-slate-600">Target:</span>{' '}
              <span className="font-mono text-slate-400">
                {entry.targetType}
                {entry.targetId && ` / ${entry.targetId.length > 20 ? entry.targetId.slice(0, 20) + '…' : entry.targetId}`}
              </span>
            </span>
          )}
          {entry.ipAddress && (
            <span className="text-slate-500">
              <span className="text-slate-600">IP:</span>{' '}
              <span className="font-mono text-slate-400">{entry.ipAddress}</span>
            </span>
          )}
        </div>

        {/* Metadata expandable */}
        {hasMetadata && (
          <div className="mt-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-400 transition-colors"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Metadata
            </button>
            {expanded && (
              <pre className="mt-1.5 p-3 bg-surface-900 border border-surface-700 rounded text-[11px] font-mono text-slate-400 overflow-x-auto max-h-40">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function TimelineSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-4 animate-pulse">
          <div className="h-[18px] w-[18px] rounded-full bg-surface-700/50 shrink-0 mt-1.5" />
          <div className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-4 py-3 space-y-2">
            <div className="flex gap-2">
              <div className="h-4 w-24 bg-surface-700/50 rounded-full" />
              <div className="h-4 w-32 bg-surface-700/30 rounded" />
              <div className="flex-1" />
              <div className="h-4 w-14 bg-surface-700/30 rounded" />
            </div>
            <div className="h-3 w-48 bg-surface-700/20 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState('')

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── Fetch ───────────────────────────────────────────────────────────────

  const fetchLogs = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const params: Record<string, string> = { limit: '200' }
      if (actionFilter) params['action'] = actionFilter

      const { data } = await api.get<{ logs: AuditEntry[]; count: number }>('/api/audit-log', { params })

      if (!mountedRef.current) return
      setEntries(data.logs)
    } catch (err: unknown) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load audit log')
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [actionFilter])

  useEffect(() => {
    void fetchLogs()
  }, [fetchLogs])

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in-up space-y-5 max-w-4xl">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Audit Log</h1>
          <p className="text-sm text-slate-400">System-wide activity trail and AI decisions</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => void fetchLogs()}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-brand-500/10 text-brand-500 border border-brand-500/20">
            <Shield className="h-3 w-3" />
            Admin Only
          </div>
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 bg-surface-800 border border-surface-700 rounded-card px-4 py-3">
        <Filter className="h-4 w-4 text-slate-500 shrink-0" />

        <div className="flex items-center gap-2">
          <label htmlFor="audit-action-filter" className="text-[11px] font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap">
            Action
          </label>
          <select
            id="audit-action-filter"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="bg-surface-900 border border-surface-700 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors appearance-none cursor-pointer min-w-[170px] font-mono text-xs"
          >
            {ACTION_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        <p className="text-xs text-slate-500 shrink-0">
          <span className="text-slate-300 font-mono">{entries.length}</span> entries
        </p>
      </div>

      {/* ── Error ────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-danger-500/10 border border-danger-500/30">
          <ClipboardList className="h-4 w-4 text-danger-500 shrink-0" />
          <p className="text-sm text-danger-500">{error}</p>
        </div>
      )}

      {/* ── Timeline ─────────────────────────────────────────────── */}
      {isLoading ? (
        <TimelineSkeleton />
      ) : entries.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardList className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-400">No audit entries</p>
          <p className="text-xs text-slate-600 mt-1">Activity will appear here as the system operates</p>
        </div>
      ) : (
        <div className="pl-1">
          {entries.map((entry) => (
            <TimelineEntry key={entry._id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}
