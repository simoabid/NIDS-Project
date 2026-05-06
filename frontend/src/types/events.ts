// ─────────────────────────────────────────────────────────────────────────────
// Socket.io Event Types — Frontend mirror
// src/types/events.ts
//
// Keep in sync with backend/src/types/events.ts.
// These are the contracts the frontend consumes from the Socket.io stream.
// ─────────────────────────────────────────────────────────────────────────────

export interface AlertPayload {
  id: string
  sourceIp: string
  destinationIp: string
  sourcePort: number
  destinationPort: number
  protocol: string
  attackType: 'Normal' | 'DoS' | 'PortScan' | 'Unknown'
  confidence: number       // 0.0 – 1.0
  packetSize: number       // bytes
  timestamp: string        // ISO 8601
}

export interface StatsPayload {
  totalPackets: number
  normalCount: number
  attackCount: number
  detectionRate: number    // 0–100
  avgConfidence: number
  topAttackType: string
  captureActive: boolean
  timestamp: string
}

export interface CaptureStatusPayload {
  active: boolean
  interface: string | null
  startedAt: string | null
}

// Server → Client (what the frontend listens to)
export interface ServerToClientEvents {
  'alert:new':      (payload: AlertPayload) => void
  'stats:update':   (payload: StatsPayload) => void
  'capture:status': (payload: CaptureStatusPayload) => void
}

// Client → Server (what the frontend emits)
export interface ClientToServerEvents {
  'capture:start':  (iface: string) => void
  'capture:stop':   () => void
  'stats:request':  () => void
}
