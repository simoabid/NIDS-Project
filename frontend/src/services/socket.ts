// ─────────────────────────────────────────────────────────────────────────────
// Socket.io client
// src/services/socket.ts
//
// Exports a single lazily-connected socket instance.
// The socket is NOT connected until connect() is called (after login).
// Call disconnect() on logout so no authenticated events leak between sessions.
//
// Reconnection strategy:
//   - autoConnect: false   — we connect manually after login
//   - reconnection: true   — Socket.io handles exponential back-off
//   - reconnectionAttempts: Infinity — a security dashboard must never give up
//   - Connection counter + isReconnect() lets hooks distinguish initial
//     connect from reconnections to recover missed data without double-fetching.
// ─────────────────────────────────────────────────────────────────────────────

import { io, type Socket } from 'socket.io-client'
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from '@/types/events'

// Typed socket — the generic parameters mirror the backend's socketService.ts
type NidsSocket = Socket<ServerToClientEvents, ClientToServerEvents>

const WS_URL = import.meta.env.VITE_WS_URL ?? ''  // empty → same origin (Vite proxy in dev)

// Create disconnected socket — autoConnect: false prevents a connection
// attempt before the user is authenticated and a token is available.
const socket: NidsSocket = io(WS_URL, {
  autoConnect: false,
  reconnection: true,                       // explicit — never disabled by accident
  transports: ['polling', 'websocket'],     // mirrors backend transports
  reconnectionAttempts: Infinity,           // security dashboard must never give up
  reconnectionDelay: 2_000,                 // 2s → 4s → 8s → … → 30s max
  reconnectionDelayMax: 30_000,
})

// ── Reconnection tracking ───────────────────────────────────────────────────
// Socket.io's `connect` fires on BOTH the initial connection and all
// subsequent reconnections. A connection counter lets hooks distinguish:
//   connectCount === 1  → first connect (skip recovery, initial fetch handles it)
//   connectCount >= 2   → reconnection (recover missed data via REST)

let connectCount = 0

socket.on('connect', () => {
  connectCount += 1
})

// ── Debug logging (development only) ────────────────────────────────────────
if (import.meta.env.DEV) {
  socket.on('connect',         ()    => console.log('[Socket] Connected:', socket.id))
  socket.on('disconnect',      (r)   => console.log('[Socket] Disconnected:', r))
  socket.on('connect_error',   (err) => console.warn('[Socket] Error:', err.message))
}

// ── Connection helpers ────────────────────────────────────────────────────────

/**
 * Connect the socket, passing the current JWT for server-side auth.
 * Call this after a successful login.
 */
export function connectSocket(token: string): void {
  connectCount = 0  // reset on fresh login
  socket.auth = { token }
  socket.connect()
}

/**
 * Disconnect the socket and clear auth data.
 * Call this on logout.
 */
export function disconnectSocket(): void {
  connectCount = 0
  socket.auth = {}
  socket.disconnect()
}

/**
 * Returns true if the current `connect` event is a reconnection (not the first).
 * Call this inside a socket `connect` handler — it reads the counter AFTER
 * the socket.ts handler has already incremented it.
 *
 *   connectCount === 0  → not yet connected
 *   connectCount === 1  → first connect
 *   connectCount >= 2   → reconnection
 */
export function isReconnect(): boolean {
  return connectCount > 1
}

export default socket

