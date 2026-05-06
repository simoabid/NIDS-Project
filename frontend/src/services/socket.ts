// ─────────────────────────────────────────────────────────────────────────────
// Socket.io client
// src/services/socket.ts
//
// Exports a single lazily-connected socket instance.
// The socket is NOT connected until connect() is called (after login).
// Call disconnect() on logout so no authenticated events leak between sessions.
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
  transports: ['polling', 'websocket'],   // mirrors backend transports
  reconnectionAttempts: 10,
  reconnectionDelay: 2_000,
  reconnectionDelayMax: 10_000,
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
  socket.auth = { token }
  socket.connect()
}

/**
 * Disconnect the socket and clear auth data.
 * Call this on logout.
 */
export function disconnectSocket(): void {
  socket.auth = {}
  socket.disconnect()
}

export default socket
