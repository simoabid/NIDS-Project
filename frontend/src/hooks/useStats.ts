// ── useStats — live dashboard statistics ───────────────────────────────────
// frontend/src/hooks/useStats.ts
//
// Provides two complementary data streams for the dashboard:
//
//   1. `liveStats`  — real-time telemetry pushed via Socket.io `stats:update`
//                     events (totalPackets, detectionRate, avgConfidence, etc.)
//
//   2. `dbStats`    — aggregated historical data from GET /api/alerts/stats
//                     (byAttackType, bySeverity, byStatus — for charts)
//
// On mount the hook fetches dbStats immediately so charts aren't empty.
// The Socket.io listener updates liveStats on every broadcast (~10 s).
// On reconnect, dbStats is re-fetched to fill any gap.
// ───────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react'
import api from '@/services/api'
import socket, { isReconnect } from '@/services/socket'
import type { StatsPayload } from '@/types/events'

// ── Types ──────────────────────────────────────────────────────────────────

/** Aggregated stats from GET /api/alerts/stats */
export interface DbStats {
  total: number
  last24h: number
  byAttackType: Record<string, number>
  bySeverity: Record<string, number>
  byStatus: Record<string, number>
}

/** Live telemetry from the stats:update Socket.io event */
export type LiveStats = StatsPayload

interface StatsState {
  liveStats: LiveStats | null
  dbStats: DbStats | null
  isLoading: boolean
  error: string | null
}

// ── Constants ──────────────────────────────────────────────────────────────

const EMPTY_DB_STATS: DbStats = {
  total: 0,
  last24h: 0,
  byAttackType: {},
  bySeverity: {},
  byStatus: {},
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useStats() {
  const [state, setState] = useState<StatsState>({
    liveStats: null,
    dbStats: null,
    isLoading: true,
    error: null,
  })

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── REST fetch — aggregated DB stats ──────────────────────────────────

  const fetchDbStats = useCallback(async () => {
    try {
      const { data } = await api.get<DbStats>('/api/alerts/stats')
      if (!mountedRef.current) return

      setState((prev) => ({
        ...prev,
        dbStats: data,
        isLoading: false,
        error: null,
      }))
    } catch (err: unknown) {
      if (!mountedRef.current) return
      const message =
        err instanceof Error ? err.message : 'Failed to load statistics'
      setState((prev) => ({
        ...prev,
        dbStats: prev.dbStats ?? EMPTY_DB_STATS,
        isLoading: false,
        error: message,
      }))
    }
  }, [])

  // ── Initial fetch ─────────────────────────────────────────────────────

  useEffect(() => {
    void fetchDbStats()
  }, [fetchDbStats])

  // ── Socket.io listener — live stats ───────────────────────────────────

  useEffect(() => {
    function handleStatsUpdate(payload: StatsPayload) {
      if (!mountedRef.current) return

      setState((prev) => ({
        ...prev,
        liveStats: payload,
        isLoading: false,
        error: null,
      }))
    }

    socket.on('stats:update', handleStatsUpdate)
    return () => { socket.off('stats:update', handleStatsUpdate) }
  }, [])

  // ── Reconnect — re-fetch DB stats to fill gap ─────────────────────────

  useEffect(() => {
    function handleReconnect() {
      if (!mountedRef.current) return
      // Skip initial connection — the mount useEffect already fetches
      if (!isReconnect()) return
      void fetchDbStats()
    }

    socket.on('connect', handleReconnect)
    return () => { socket.off('connect', handleReconnect) }
  }, [fetchDbStats])

  // ── Public API ────────────────────────────────────────────────────────

  return {
    /** Real-time telemetry from the last stats:update event (null until first broadcast) */
    liveStats: state.liveStats,
    /** Aggregated historical stats from the database */
    dbStats: state.dbStats ?? EMPTY_DB_STATS,
    /** True during the initial REST fetch */
    isLoading: state.isLoading,
    /** Error message from the last failed REST call, or null */
    error: state.error,
    /** Manually re-fetch aggregated stats from the database */
    refetchDbStats: fetchDbStats,
  }
}
