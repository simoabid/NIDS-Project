// ── AlertBanner — critical/high alert notifications ───────────────────────
// frontend/src/components/dashboard/AlertBanner.tsx
//
// Two notification layers:
//
//   1. **Persistent banner** — a red/amber strip at the top of the dashboard
//      when a DoS (critical) or PortScan (high) alert arrives. Auto-dismisses
//      after 8 seconds with a visible countdown progress bar. Normal traffic
//      is ignored.
//
//   2. **Sonner toast** — fires alongside the banner so users see the alert
//      even if they've scrolled past the banner. Uses Sonner's existing
//      <Toaster> mounted in main.tsx.
//
// Design note (from Stitch exploration):
//   The countdown progress bar at the bottom of the banner gives analysts a
//   visual cue that the banner is temporary — reducing "alarm fatigue" while
//   keeping the urgency of the initial appearance.
// ───────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { ShieldAlert, Radar, X } from 'lucide-react'
import socket from '@/services/socket'
import type { AlertPayload } from '@/types/events'

// ── Types ──────────────────────────────────────────────────────────────────

interface BannerAlert {
  id: string
  attackType: 'DoS' | 'PortScan' | 'Unknown'
  sourceIp: string
  destinationIp: string
  confidence: number
  timestamp: string
}

// ── Constants ──────────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 8_000

const SEVERITY_CONFIG = {
  DoS: {
    label: 'DoS Attack Detected',
    icon: <ShieldAlert className="h-4 w-4" />,
    bg: 'bg-danger-500/10',
    border: 'border-danger-500/30',
    text: 'text-danger-500',
    accent: 'bg-danger-500',
    progressColor: '#ef4444',
  },
  PortScan: {
    label: 'Port Scan Detected',
    icon: <Radar className="h-4 w-4" />,
    bg: 'bg-warning-500/10',
    border: 'border-warning-500/30',
    text: 'text-warning-500',
    accent: 'bg-warning-500',
    progressColor: '#f59e0b',
  },
  Unknown: {
    label: 'Suspicious Activity',
    icon: <ShieldAlert className="h-4 w-4" />,
    bg: 'bg-brand-500/10',
    border: 'border-brand-500/30',
    text: 'text-brand-500',
    accent: 'bg-brand-500',
    progressColor: '#6366f1',
  },
} as const

// ── Component ──────────────────────────────────────────────────────────────

export default function AlertBanner() {
  const [banner, setBanner] = useState<BannerAlert | null>(null)
  const [animKey, setAnimKey] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    setBanner(null)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    function handleAlert(payload: AlertPayload) {
      // Only show for attack traffic
      if (payload.attackType === 'Normal') return

      const alert: BannerAlert = {
        id: payload.id,
        attackType: payload.attackType,
        sourceIp: payload.sourceIp,
        destinationIp: payload.destinationIp,
        confidence: payload.confidence,
        timestamp: payload.timestamp,
      }

      // ── 1. Persistent banner ────────────────────────────────────────
      setBanner(alert)
      // Reset the progress bar animation by changing the key
      setAnimKey((k) => k + 1)

      // Auto-dismiss after 8 seconds
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setBanner(null)
        timerRef.current = null
      }, AUTO_DISMISS_MS)

      // ── 2. Sonner toast ─────────────────────────────────────────────
      const config = SEVERITY_CONFIG[alert.attackType]
      const severity = alert.attackType === 'DoS' ? 'error' : 'warning'

      toast[severity](`${config.label}`, {
        description: `${alert.sourceIp} → ${alert.destinationIp} (${(alert.confidence * 100).toFixed(0)}% confidence)`,
        duration: AUTO_DISMISS_MS,
      })
    }

    socket.on('alert:new', handleAlert)
    return () => {
      socket.off('alert:new', handleAlert)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // ── Nothing to show ─────────────────────────────────────────────────

  if (!banner) return null

  const config = SEVERITY_CONFIG[banner.attackType]

  // ── Render banner ───────────────────────────────────────────────────

  return (
    <div
      role="alert"
      className={[
        'relative overflow-hidden rounded-card border mb-4 animate-fade-in-up',
        config.bg,
        config.border,
      ].join(' ')}
    >
      {/* Main content row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Accent bar */}
        <div className={`w-1 h-8 rounded-full ${config.accent} shrink-0`} />

        {/* Icon */}
        <div className={config.text}>
          {config.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${config.text}`}>
            {config.label}
          </p>
          <p className="text-xs text-slate-400 truncate">
            <span className="font-mono">{banner.sourceIp}</span>
            <span className="mx-1.5 text-slate-600">→</span>
            <span className="font-mono">{banner.destinationIp}</span>
            <span className="mx-1.5 text-slate-600">·</span>
            <span>{(banner.confidence * 100).toFixed(0)}% confidence</span>
          </p>
        </div>

        {/* Dismiss */}
        <button
          onClick={dismiss}
          className="text-slate-500 hover:text-white transition-colors shrink-0"
          aria-label="Dismiss alert"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Countdown progress bar — shrinks from 100% to 0% over 8s */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-transparent">
        <div
          key={animKey}
          className="h-full rounded-full"
          style={{
            backgroundColor: config.progressColor,
            animation: `banner-countdown ${AUTO_DISMISS_MS}ms linear forwards`,
          }}
        />
      </div>

      <style>{`
        @keyframes banner-countdown {
          from { width: 100%; opacity: 0.7; }
          to   { width: 0%;   opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
