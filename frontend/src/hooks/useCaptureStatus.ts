// ── useCaptureStatus — real-time capture on/off state ──────────────────────
// frontend/src/hooks/useCaptureStatus.ts
//
// Tracks whether the traffic capture session is active or idle.
//
//   - On mount: fetches GET /api/capture/status for the current state
//   - Live:     listens to capture:status Socket.io events
//   - Actions:  exposes startCapture / stopCapture that call the REST API
//               (the backend broadcasts capture:status after each mutation,
//                so the hook's socket listener updates all clients)
//
// The start/stop REST calls require admin role — the backend enforces RBAC.
// ───────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react'
import { isAxiosError } from 'axios'
import api from '@/services/api'
import socket, { isReconnect } from '@/services/socket'
import type { CaptureStatusPayload } from '@/types/events'

// ── Types ──────────────────────────────────────────────────────────────────

/** Capture stats returned by the backend alongside the status */
export interface CaptureStats {
  flowsProcessed: number
  flowsPublished: number
  errors: number
  startedAt: string | null
  interface: string | null
  mode: 'live' | 'pcap' | 'idle'
}

interface CaptureState {
  status: CaptureStatusPayload
  stats: CaptureStats | null
  isLoading: boolean
  error: string | null
  isStarting: boolean
  isStopping: boolean
}

// ── Constants ──────────────────────────────────────────────────────────────

const IDLE_STATUS: CaptureStatusPayload = {
  active: false,
  interface: null,
  startedAt: null,
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useCaptureStatus() {
  const [state, setState] = useState<CaptureState>({
    status: IDLE_STATUS,
    stats: null,
    isLoading: true,
    error: null,
    isStarting: false,
    isStopping: false,
  })

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── REST fetch — initial capture state ────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get<{
        status: CaptureStatusPayload
        stats: CaptureStats
      }>('/api/capture/status')

      if (!mountedRef.current) return

      setState((prev) => ({
        ...prev,
        status: data.status,
        stats: data.stats,
        isLoading: false,
        error: null,
      }))
    } catch (err: unknown) {
      if (!mountedRef.current) return
      const message =
        err instanceof Error ? err.message : 'Failed to load capture status'
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }))
    }
  }, [])

  // ── Initial fetch ─────────────────────────────────────────────────────

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  // ── Socket.io listener — live status updates ──────────────────────────

  useEffect(() => {
    function handleCaptureStatus(payload: CaptureStatusPayload) {
      if (!mountedRef.current) return

      setState((prev) => ({
        ...prev,
        status: payload,
        isLoading: false,
        error: null,
        isStarting: false,
        isStopping: false,
      }))
    }

    socket.on('capture:status', handleCaptureStatus)
    return () => { socket.off('capture:status', handleCaptureStatus) }
  }, [])

  // ── Reconnect — re-fetch to sync state after disconnection ────────────

  useEffect(() => {
    function handleReconnect() {
      if (!mountedRef.current) return
      // Skip initial connection — the mount useEffect already fetches
      if (!isReconnect()) return
      void fetchStatus()
    }

    socket.on('connect', handleReconnect)
    return () => { socket.off('connect', handleReconnect) }
  }, [fetchStatus])

  // ── Actions ───────────────────────────────────────────────────────────

  const startCapture = useCallback(async (iface: string) => {
    setState((prev) => ({ ...prev, isStarting: true, error: null }))

    try {
      const { data } = await api.post<{
        message: string
        status: CaptureStatusPayload
        stats: CaptureStats
      }>('/api/capture/start', { interface: iface })

      if (!mountedRef.current) return

      setState((prev) => ({
        ...prev,
        status: data.status,
        stats: data.stats,
        isStarting: false,
        error: null,
      }))
    } catch (err: unknown) {
      if (!mountedRef.current) return

      let message = 'Failed to start capture'
      if (isAxiosError(err)) {
        message = (err.response?.data as { message?: string })?.message ?? message
      }

      setState((prev) => ({
        ...prev,
        isStarting: false,
        error: message,
      }))
    }
  }, [])

  const stopCapture = useCallback(async () => {
    setState((prev) => ({ ...prev, isStopping: true, error: null }))

    try {
      const { data } = await api.post<{
        message: string
        status: CaptureStatusPayload
        stats: CaptureStats
      }>('/api/capture/stop')

      if (!mountedRef.current) return

      setState((prev) => ({
        ...prev,
        status: data.status,
        stats: data.stats,
        isStopping: false,
        error: null,
      }))
    } catch (err: unknown) {
      if (!mountedRef.current) return

      let message = 'Failed to stop capture'
      if (isAxiosError(err)) {
        message = (err.response?.data as { message?: string })?.message ?? message
      }

      setState((prev) => ({
        ...prev,
        isStopping: false,
        error: message,
      }))
    }
  }, [])

  // ── Public API ────────────────────────────────────────────────────────

  return {
    /** Whether the capture session is currently active */
    isActive: state.status.active,
    /** Full capture status payload */
    status: state.status,
    /** Capture session statistics (flowsProcessed, errors, etc.) */
    stats: state.stats,
    /** True during the initial REST fetch */
    isLoading: state.isLoading,
    /** Error message from the last failed action or fetch */
    error: state.error,
    /** True while a start request is in flight */
    isStarting: state.isStarting,
    /** True while a stop request is in flight */
    isStopping: state.isStopping,
    /** Start a capture session on the given network interface (admin only) */
    startCapture,
    /** Stop the active capture session (admin only) */
    stopCapture,
    /** Manually re-fetch the capture status from the server */
    refetch: fetchStatus,
  }
}
