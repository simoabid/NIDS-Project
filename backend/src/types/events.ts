// ─────────────────────────────────────────────────────────────────────────────
// Socket.io Event Type Contracts
// src/types/events.ts
//
// Shared between socketService and any emitter (controllers, services).
// Using these interfaces ensures the server and client speak the same language.
// ─────────────────────────────────────────────────────────────────────────────

// ── Payloads ─────────────────────────────────────────────────────────────────

/** Emitted when the AI microservice detects an attack */
export interface AlertPayload {
  id: string;                                          // MongoDB ObjectId (string)
  sourceIp: string;                                    // e.g. "192.168.1.42"
  destinationIp: string;
  sourcePort: number;
  destinationPort: number;
  protocol: string;                                    // e.g. "TCP", "UDP"
  attackType: 'Normal' | 'DoS' | 'PortScan' | 'Unknown';
  confidence: number;                                  // 0.0 – 1.0
  packetSize: number;                                  // bytes
  timestamp: string;                                   // ISO 8601
}

/** Emitted periodically with aggregate traffic statistics */
export interface StatsPayload {
  totalPackets: number;
  normalCount: number;
  attackCount: number;
  detectionRate: number;                               // percentage 0–100
  avgConfidence: number;                               // mean confidence of attacks
  topAttackType: string;
  captureActive: boolean;
  timestamp: string;                                   // ISO 8601
}

/** Emitted when the capture session state changes */
export interface CaptureStatusPayload {
  active: boolean;
  interface: string | null;                            // e.g. "eth0"
  startedAt: string | null;                            // ISO 8601
}

// ── Server → Client events ────────────────────────────────────────────────────
export interface ServerToClientEvents {
  /** A new threat has been detected — display an alert banner */
  'alert:new': (payload: AlertPayload) => void;

  /** Periodic traffic statistics update — refresh charts */
  'stats:update': (payload: StatsPayload) => void;

  /** Capture session started or stopped */
  'capture:status': (payload: CaptureStatusPayload) => void;
}

// ── Client → Server events ────────────────────────────────────────────────────
export interface ClientToServerEvents {
  /** Admin requests to start real-time capture */
  'capture:start': (iface: string) => void;

  /** Admin requests to stop real-time capture */
  'capture:stop': () => void;

  /** Client requests the latest stats snapshot immediately */
  'stats:request': () => void;
}

// ── Inter-server events (for multi-node clustering) ───────────────────────────
export interface InterServerEvents {
  ping: () => void;
}

// ── Per-socket data (attached after JWT auth) ─────────────────────────────────
export interface SocketData {
  userId: string;
  role: 'admin' | 'viewer';
}
