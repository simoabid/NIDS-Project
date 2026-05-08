// ── CapturePage — admin-only capture control panel ────────────────────────
// frontend/src/pages/CapturePage.tsx
//
// Admin-only page for managing traffic capture sessions. Provides:
//   - Status hero card with real-time stats (idle vs active states)
//   - Mode selector tabs: Live Capture vs PCAP Analysis
//   - Start/Stop controls with proper loading + error states
//   - All actions flow through useCaptureStatus() → REST → Socket.io broadcast
//
// Design based on Stitch exploration: command-center aesthetic, prominent
// status card, clear action hierarchy (indigo start / red stop).
// ───────────────────────────────────────────────────────────────────────────

import { useState, useCallback, type FormEvent } from 'react'
import {
  Radio,
  FileUp,
  Play,
  Square,
  Shield,
  Activity,
  CircleDot,
  AlertCircle,
  Loader2,
  Wifi,
  Clock,
  Zap,
  XCircle,
} from 'lucide-react'
import { useCaptureStatus } from '@/hooks/useCaptureStatus'
import api from '@/services/api'

// ── Types ──────────────────────────────────────────────────────────────────

type CaptureMode = 'live' | 'pcap'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Format elapsed time from a start timestamp */
function formatUptime(startedAt: string | null): string {
  if (!startedAt) return '—'
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  if (elapsed < 60) return `${elapsed}s`
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  return `${h}h ${m}m`
}

/** Format a number with commas */
function fmt(n: number): string {
  return n.toLocaleString()
}

// ── Mini stat box ──────────────────────────────────────────────────────────

interface MiniStatProps {
  icon: React.ReactNode
  label: string
  value: string | number
  color?: string
}

function MiniStat({ icon, label, value, color = 'text-white' }: MiniStatProps) {
  return (
    <div className="flex items-center gap-3 bg-surface-900/50 border border-surface-700/50 rounded-lg px-4 py-3">
      <div className="text-slate-500">{icon}</div>
      <div>
        <p className="text-[11px] text-slate-500 uppercase tracking-wider">{label}</p>
        <p className={`text-sm font-semibold font-mono ${color}`}>{typeof value === 'number' ? fmt(value) : value}</p>
      </div>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function CapturePage() {
  const {
    isActive,
    status,
    stats,
    isLoading,
    error,
    isStarting,
    isStopping,
    startCapture,
    stopCapture,
  } = useCaptureStatus()

  const [mode, setMode] = useState<CaptureMode>('live')
  const [iface, setIface] = useState('')
  const [pcapPath, setPcapPath] = useState('')

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleStart = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (mode === 'live' && iface.trim()) {
        await startCapture(iface.trim())
      }
      // pcap mode would call a separate endpoint — handled below
    },
    [mode, iface, startCapture],
  )

  const handlePcap = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!pcapPath.trim()) return
      try {
        await api.post('/api/capture/pcap', { pcapPath: pcapPath.trim() })
      } catch {
        // Error surfaces through socket listener or useCaptureStatus
      }
    },
    [pcapPath],
  )

  const handleStop = useCallback(async () => {
    await stopCapture()
  }, [stopCapture])

  // ── Loading skeleton ──────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="animate-fade-in-up space-y-6">
        <div>
          <div className="h-6 w-48 bg-surface-700/50 rounded animate-pulse mb-2" />
          <div className="h-4 w-72 bg-surface-700/30 rounded animate-pulse" />
        </div>
        <div className="h-48 bg-surface-800 border border-surface-700 rounded-card animate-pulse" />
        <div className="h-10 w-64 bg-surface-800 border border-surface-700 rounded-card animate-pulse" />
        <div className="h-40 bg-surface-800 border border-surface-700 rounded-card animate-pulse" />
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in-up space-y-6 max-w-3xl">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Capture Control</h1>
          <p className="text-sm text-slate-400">Start, stop, and monitor traffic capture sessions</p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-brand-500/10 text-brand-500 border border-brand-500/20 shrink-0">
          <Shield className="h-3 w-3" />
          Admin Only
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-danger-500/10 border border-danger-500/30 animate-fade-in-up">
          <AlertCircle className="h-4 w-4 text-danger-500 shrink-0" />
          <p className="text-sm text-danger-500">{error}</p>
        </div>
      )}

      {/* ── Status hero card ─────────────────────────────────────── */}
      <div
        className={[
          'rounded-card p-6 transition-colors',
          isActive
            ? 'bg-success-500/5 border-2 border-success-500/20'
            : 'bg-surface-800 border-2 border-dashed border-surface-700',
        ].join(' ')}
      >
        <div className="flex items-start gap-4">
          {/* Status indicator */}
          <div className="mt-0.5">
            {isActive ? (
              <span className="relative flex h-4 w-4">
                <span className="absolute inline-flex h-full w-full rounded-full bg-success-500 opacity-50 animate-ping" />
                <span className="relative inline-flex h-4 w-4 rounded-full bg-success-500" />
              </span>
            ) : (
              <CircleDot className="h-5 w-5 text-slate-600" />
            )}
          </div>

          {/* Status text */}
          <div className="flex-1 min-w-0">
            <h2 className={`text-lg font-semibold ${isActive ? 'text-success-500' : 'text-slate-400'}`}>
              {isActive ? 'Capturing' : 'Capture Idle'}
            </h2>
            {isActive ? (
              <div className="space-y-1 mt-1">
                <p className="text-sm text-slate-400">
                  Interface: <span className="font-mono text-white">{status.interface ?? '—'}</span>
                </p>
                {status.startedAt && (
                  <p className="text-sm text-slate-400">
                    Running for <span className="text-white font-mono">{formatUptime(status.startedAt)}</span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 mt-0.5">No active capture session</p>
            )}
          </div>
        </div>

        {/* Active session stats */}
        {isActive && stats && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
            <MiniStat
              icon={<Activity className="h-4 w-4" />}
              label="Flows Processed"
              value={stats.flowsProcessed}
            />
            <MiniStat
              icon={<Zap className="h-4 w-4" />}
              label="Flows Published"
              value={stats.flowsPublished}
              color="text-brand-500"
            />
            <MiniStat
              icon={<XCircle className="h-4 w-4" />}
              label="Errors"
              value={stats.errors}
              color={stats.errors > 0 ? 'text-danger-500' : 'text-success-500'}
            />
          </div>
        )}
      </div>

      {/* ── Mode selector tabs ───────────────────────────────────── */}
      {!isActive && (
        <>
          <div className="flex border-b border-surface-700">
            <button
              onClick={() => setMode('live')}
              className={[
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                mode === 'live'
                  ? 'border-brand-500 text-brand-500'
                  : 'border-transparent text-slate-500 hover:text-white',
              ].join(' ')}
            >
              <Radio className="h-4 w-4" />
              Live Capture
            </button>
            <button
              onClick={() => setMode('pcap')}
              className={[
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                mode === 'pcap'
                  ? 'border-brand-500 text-brand-500'
                  : 'border-transparent text-slate-500 hover:text-white',
              ].join(' ')}
            >
              <FileUp className="h-4 w-4" />
              PCAP Analysis
            </button>
          </div>

          {/* ── Live capture form ─────────────────────────────────── */}
          {mode === 'live' && (
            <form onSubmit={handleStart} className="bg-surface-800 border border-surface-700 rounded-card p-5 space-y-4">
              <div>
                <label htmlFor="capture-iface" className="block text-sm font-medium text-white mb-1.5">
                  Network Interface
                </label>
                <div className="relative">
                  <Wifi className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    id="capture-iface"
                    type="text"
                    value={iface}
                    onChange={(e) => setIface(e.target.value)}
                    placeholder="eth0"
                    className="w-full bg-surface-900 border border-surface-700 text-sm text-white rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors placeholder:text-slate-600"
                    autoComplete="off"
                  />
                </div>
                <p className="text-[11px] text-slate-600 mt-1.5">
                  Enter the network interface name (e.g., eth0, wlan0, ens33)
                </p>
              </div>

              <button
                type="submit"
                disabled={!iface.trim() || isStarting}
                className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isStarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isStarting ? 'Starting…' : 'Start Capture'}
              </button>
            </form>
          )}

          {/* ── PCAP analysis form ────────────────────────────────── */}
          {mode === 'pcap' && (
            <form onSubmit={handlePcap} className="bg-surface-800 border border-surface-700 rounded-card p-5 space-y-4">
              <div>
                <label htmlFor="capture-pcap" className="block text-sm font-medium text-white mb-1.5">
                  PCAP File Path
                </label>
                <div className="relative">
                  <FileUp className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    id="capture-pcap"
                    type="text"
                    value={pcapPath}
                    onChange={(e) => setPcapPath(e.target.value)}
                    placeholder="/path/to/capture.pcap"
                    className="w-full bg-surface-900 border border-surface-700 text-sm text-white rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors placeholder:text-slate-600 font-mono"
                    autoComplete="off"
                  />
                </div>
                <p className="text-[11px] text-slate-600 mt-1.5">
                  Provide the absolute path to a .pcap file on the server
                </p>
              </div>

              <button
                type="submit"
                disabled={!pcapPath.trim() || isStarting}
                className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isStarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {isStarting ? 'Processing…' : 'Process File'}
              </button>
            </form>
          )}
        </>
      )}

      {/* ── Stop control (danger zone) ───────────────────────────── */}
      {isActive && (
        <div className="bg-danger-500/5 border border-danger-500/20 rounded-card p-5">
          <div className="flex items-start gap-4">
            <div className="mt-0.5">
              <Square className="h-5 w-5 text-danger-500" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-danger-500 mb-1">Stop Capture</h3>
              <p className="text-xs text-slate-500 mb-4">
                This will immediately halt the active capture session. All processed data is preserved.
              </p>
              <button
                onClick={handleStop}
                disabled={isStopping}
                className="flex items-center justify-center gap-2 px-6 py-2 bg-danger-500 hover:bg-danger-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isStopping ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {isStopping ? 'Stopping…' : 'Stop Capture'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Session info footer ──────────────────────────────────── */}
      {stats && (
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          <Clock className="h-3 w-3" />
          <span>
            Mode: <span className="text-slate-400">{stats.mode}</span>
            {stats.interface && (
              <>
                <span className="mx-1.5">·</span>
                Interface: <span className="text-slate-400 font-mono">{stats.interface}</span>
              </>
            )}
            {stats.startedAt && (
              <>
                <span className="mx-1.5">·</span>
                Started: <span className="text-slate-400">{new Date(stats.startedAt).toLocaleTimeString()}</span>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
