// ── useAlerts — live alert list with Socket.io + REST ──────────────────────
// frontend/src/hooks/useAlerts.ts
//
// Loads initial alert history from GET /api/alerts on mount, then listens
// to the `alert:new` Socket.io event to prepend new alerts in real time.
//
// Reconnection strategy:
//   socketService.ts already handles exponential back-off reconnection.
//   When the socket reconnects (the `connect` event fires again), this hook
//   re-fetches the latest page from REST to fill any gap that occurred
//   during the disconnection window.
//
// Consumers get a single stable interface:
//   const { alerts, isLoading, error, pagination, fetchPage } = useAlerts()
// ───────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react'
import api from '@/services/api'
import socket, { isReconnect } from '@/services/socket'
import type { AlertPayload } from '@/types/events'

// ── Types ──────────────────────────────────────────────────────────────────

/** Severity derived from attackType — mirrors backend Alert model */
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** Alert status lifecycle */
type AlertStatus = 'new' | 'acknowledged' | 'resolved' | 'false_positive'

/**
 * Unified alert shape consumed by the UI.
 * REST responses contain all fields; Socket.io payloads only carry
 * the AI-side fields. Missing persistence fields get defaults.
 */
export interface Alert {
  id: string
  sourceIp: string
  destinationIp: string
  sourcePort: number
  destinationPort: number
  protocol: string
  attackType: 'Normal' | 'DoS' | 'PortScan' | 'Unknown'
  confidence: number
  packetSize: number
  severity: Severity
  status: AlertStatus
  timestamp: string      // ISO 8601
  createdAt: string      // ISO 8601
}

export interface Pagination {
  page: number
  limit: number
  total: number
  pages: number
}

interface AlertsState {
  alerts: Alert[]
  isLoading: boolean
  error: string | null
  pagination: Pagination
}

/** Optional filters passed to the REST endpoint */
export interface AlertFilters {
  attackType?: 'Normal' | 'DoS' | 'PortScan' | 'Unknown'
  severity?: Severity
  status?: AlertStatus
  sourceIp?: string
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20
const MAX_LIVE_ALERTS = 200  // cap in-memory list to prevent unbounded growth

const SEVERITY_MAP: Record<string, Severity> = {
  DoS:      'critical',
  PortScan: 'high',
  Unknown:  'medium',
  Normal:   'low',
}

const EMPTY_PAGINATION: Pagination = {
  page: 1,
  limit: DEFAULT_LIMIT,
  total: 0,
  pages: 0,
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convert a raw MongoDB document from the REST API into a normalised Alert */
function normaliseRestAlert(raw: Record<string, unknown>): Alert {
  const id = String(raw['_id'] ?? raw['id'] ?? '')
  return {
    id,
    sourceIp:        String(raw['sourceIp']        ?? '0.0.0.0'),
    destinationIp:   String(raw['destinationIp']   ?? '0.0.0.0'),
    sourcePort:      Number(raw['sourcePort']       ?? 0),
    destinationPort: Number(raw['destinationPort']  ?? 0),
    protocol:        String(raw['protocol']         ?? 'TCP'),
    attackType:      (raw['attackType'] as Alert['attackType']) ?? 'Unknown',
    confidence:      Number(raw['confidence']       ?? 0),
    packetSize:      Number(raw['packetSize']       ?? 0),
    severity:        (raw['severity'] as Severity)  ?? 'low',
    status:          (raw['status'] as AlertStatus)  ?? 'new',
    timestamp:       String(raw['timestamp']        ?? new Date().toISOString()),
    createdAt:       String(raw['createdAt']        ?? raw['timestamp'] ?? new Date().toISOString()),
  }
}

/** Convert a Socket.io AlertPayload into a normalised Alert */
function normaliseSocketAlert(payload: AlertPayload): Alert {
  return {
    id:              payload.id,
    sourceIp:        payload.sourceIp,
    destinationIp:   payload.destinationIp,
    sourcePort:      payload.sourcePort,
    destinationPort: payload.destinationPort,
    protocol:        payload.protocol,
    attackType:      payload.attackType,
    confidence:      payload.confidence,
    packetSize:      payload.packetSize,
    severity:        SEVERITY_MAP[payload.attackType] ?? 'low',
    status:          'new',
    timestamp:       payload.timestamp,
    createdAt:       payload.timestamp,
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useAlerts(filters?: AlertFilters) {
  const [state, setState] = useState<AlertsState>({
    alerts: [],
    isLoading: true,
    error: null,
    pagination: EMPTY_PAGINATION,
  })

  // Track the most recent alert ID so we can deduplicate on reconnect
  const latestIdRef = useRef<string | null>(null)

  // Track the timestamp of the most recent alert for missed-alert recovery
  const lastSeenTimestampRef = useRef<string | null>(null)

  // Track whether the component is still mounted
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── REST fetch ──────────────────────────────────────────────────────────

  const fetchAlerts = useCallback(
    async (page = 1) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))

      try {
        const params: Record<string, string | number> = {
          page,
          limit: DEFAULT_LIMIT,
        }

        // Append optional filters
        if (filters?.attackType) params['attackType'] = filters.attackType
        if (filters?.severity)   params['severity']   = filters.severity
        if (filters?.status)     params['status']     = filters.status
        if (filters?.sourceIp)   params['sourceIp']   = filters.sourceIp

        const { data } = await api.get<{
          alerts: Record<string, unknown>[]
          pagination: Pagination
        }>('/api/alerts', { params })

        if (!mountedRef.current) return

        const normalised = data.alerts.map(normaliseRestAlert)

        // Track the latest ID and timestamp for deduplication + recovery
        if (normalised.length > 0) {
          latestIdRef.current = normalised[0].id
          lastSeenTimestampRef.current = normalised[0].timestamp
        }

        setState({
          alerts: normalised,
          isLoading: false,
          error: null,
          pagination: data.pagination,
        })
      } catch (err: unknown) {
        if (!mountedRef.current) return
        const message =
          err instanceof Error ? err.message : 'Failed to load alerts'
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: message,
        }))
      }
    },
    // Re-create when filters change so the effect re-runs
    [filters?.attackType, filters?.severity, filters?.status, filters?.sourceIp],
  )

  // ── Initial fetch ───────────────────────────────────────────────────────

  useEffect(() => {
    void fetchAlerts(1)
  }, [fetchAlerts])

  // ── Socket.io listener — live prepend ───────────────────────────────────

  useEffect(() => {
    function handleNewAlert(payload: AlertPayload) {
      if (!mountedRef.current) return

      const alert = normaliseSocketAlert(payload)

      // Skip if we already have this alert (dedup on reconnect refetch)
      setState((prev) => {
        if (prev.alerts.some((a) => a.id === alert.id)) return prev

        // Prepend and cap the in-memory list
        const updated = [alert, ...prev.alerts].slice(0, MAX_LIVE_ALERTS)

        // Update the latest ID and timestamp references
        latestIdRef.current = alert.id
        lastSeenTimestampRef.current = alert.timestamp

        return {
          ...prev,
          alerts: updated,
          pagination: {
            ...prev.pagination,
            total: prev.pagination.total + 1,
          },
        }
      })
    }

    socket.on('alert:new', handleNewAlert)
    return () => { socket.off('alert:new', handleNewAlert) }
  }, [])

  // ── Reconnect — recover missed alerts ───────────────────────────────────
  // When the socket reconnects after a disconnection, the gap between
  // the last alert we received and "now" may contain alerts we missed.
  //
  // Strategy:
  //   1. Check isReconnect() to skip the initial connect (already handled
  //      by the initial fetchAlerts above).
  //   2. If we have a lastSeenTimestamp, fetch alerts created after it
  //      and merge them into the existing list (deduplicated by ID).
  //   3. If no timestamp is tracked, fall back to a full page-1 re-fetch.

  useEffect(() => {
    function handleConnect() {
      if (!mountedRef.current) return

      // Skip initial connection — the useEffect(fetchAlerts) handles it
      if (!isReconnect()) return

      const since = lastSeenTimestampRef.current

      if (!since) {
        // No timestamp reference — fall back to page-1 re-fetch
        void fetchAlerts(1)
        return
      }

      // Fetch missed alerts since the last seen timestamp
      void (async () => {
        try {
          const params: Record<string, string | number> = {
            limit: MAX_LIVE_ALERTS,
            since,
          }

          // Re-apply filters
          if (filters?.attackType) params['attackType'] = filters.attackType
          if (filters?.severity)   params['severity']   = filters.severity
          if (filters?.status)     params['status']     = filters.status
          if (filters?.sourceIp)   params['sourceIp']   = filters.sourceIp

          const { data } = await api.get<{
            alerts: Record<string, unknown>[]
            pagination: Pagination
          }>('/api/alerts', { params })

          if (!mountedRef.current) return

          const missed = data.alerts.map(normaliseRestAlert)

          if (missed.length === 0) return

          setState((prev) => {
            // Build a set of existing IDs for O(1) dedup lookup
            const existingIds = new Set(prev.alerts.map((a) => a.id))

            // Filter out duplicates
            const newAlerts = missed.filter((a) => !existingIds.has(a.id))

            if (newAlerts.length === 0) return prev

            // Merge: prepend missed alerts, sort newest first, cap the list
            const merged = [...newAlerts, ...prev.alerts]
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .slice(0, MAX_LIVE_ALERTS)

            // Update tracking refs
            if (merged.length > 0) {
              latestIdRef.current = merged[0].id
              lastSeenTimestampRef.current = merged[0].timestamp
            }

            return {
              ...prev,
              alerts: merged,
              pagination: {
                ...prev.pagination,
                total: prev.pagination.total + newAlerts.length,
              },
            }
          })
        } catch {
          // Silently fail — the live listener will pick up new alerts anyway
          // and the user can manually refresh
        }
      })()
    }

    socket.on('connect', handleConnect)
    return () => { socket.off('connect', handleConnect) }
  }, [fetchAlerts, filters?.attackType, filters?.severity, filters?.status, filters?.sourceIp])

  // ── Public API ──────────────────────────────────────────────────────────

  return {
    /** The current list of alerts (newest first, capped at MAX_LIVE_ALERTS) */
    alerts: state.alerts,
    /** True during the initial REST fetch or a page change */
    isLoading: state.isLoading,
    /** Error message from the last failed REST call, or null */
    error: state.error,
    /** Pagination metadata from the last REST response */
    pagination: state.pagination,
    /** Fetch a specific page of alerts from the REST API */
    fetchPage: fetchAlerts,
  }
}
