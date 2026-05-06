import { Server as HttpServer } from 'node:http';
import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import logger from '../config/logger.js';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  AlertPayload,
  StatsPayload,
  CaptureStatusPayload,
} from '../types/events.js';

// ─────────────────────────────────────────────────────────────────────────────
// Typed Socket.io server instance — exported so any service/controller can
// call io.emit() or io.to(room).emit() to push events to connected clients.
//
// Initialised lazily by initSocket(server) — call that BEFORE server.listen().
// ─────────────────────────────────────────────────────────────────────────────

type NidsSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type NidsServer = SocketServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

let io: NidsServer;

/** Attach Socket.io to an existing http.Server and configure all handlers. */
export function initSocket(httpServer: HttpServer): NidsServer {
  io = new SocketServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    // ── CORS ──────────────────────────────────────────────────────────────
    // Socket.io has its own CORS layer separate from Express.
    // Must mirror the same origins configured in app.ts.
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    },

    // ── Transport ─────────────────────────────────────────────────────────
    // Start with polling so the connection works even if WS is blocked,
    // then upgrade to WebSocket automatically.
    transports: ['polling', 'websocket'],

    // ── Ping / keepalive ──────────────────────────────────────────────────
    pingTimeout: 60_000,      // ms before declaring a client dead
    pingInterval: 25_000,     // ms between heartbeats
  });

  // ── JWT Authentication Middleware ────────────────────────────────────────
  // Runs before every connection. Rejects unauthenticated sockets immediately.
  io.use((socket: NidsSocket, next) => {
    // Accept token from handshake auth OR as a query param (fallback for dev)
    const token =
      (socket.handshake.auth as Record<string, string>)['token'] ??
      (socket.handshake.query['token'] as string | undefined);

    if (!token) {
      logger.warn(`[Socket] Rejected unauthenticated connection: ${socket.id}`);
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as {
        sub: string;
        role: 'admin' | 'viewer';
      };

      // Attach verified identity to the socket for use in event handlers
      socket.data.userId = decoded.sub;
      socket.data.role   = decoded.role;
      next();
    } catch {
      logger.warn(`[Socket] Rejected invalid token for socket: ${socket.id}`);
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection Handler ───────────────────────────────────────────────────
  io.on('connection', (socket: NidsSocket) => {
    const { userId, role } = socket.data;
    logger.info(`[Socket] Connected — user:${userId} role:${role} id:${socket.id}`);

    // Join role-based rooms so we can broadcast selectively:
    //   io.to('admin').emit(...)  → only admins receive this
    //   io.to('viewer').emit(...) → all authenticated users
    void socket.join(role);
    void socket.join('viewer'); // all authenticated users also join 'viewer' room

    // ── Client → Server: capture:start ──────────────────────────────────
    socket.on('capture:start', (iface: string) => {
      if (socket.data.role !== 'admin') {
        socket.emit as unknown as void;
        logger.warn(`[Socket] Unauthorised capture:start from user:${userId}`);
        socket.emit('capture:status', {
          active: false,
          interface: null,
          startedAt: null,
        });
        return;
      }
      logger.info(`[Socket] capture:start requested on interface "${iface}" by user:${userId}`);
      // TODO: delegate to captureService.start(iface) in Phase 3
    });

    // ── Client → Server: capture:stop ───────────────────────────────────
    socket.on('capture:stop', () => {
      if (socket.data.role !== 'admin') return;
      logger.info(`[Socket] capture:stop requested by user:${userId}`);
      // TODO: delegate to captureService.stop() in Phase 3
    });

    // ── Client → Server: stats:request ──────────────────────────────────
    socket.on('stats:request', () => {
      logger.debug(`[Socket] stats:request from user:${userId}`);
      // TODO: delegate to statsService.getLatest() and emit back
    });

    // ── Disconnection ────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.info(`[Socket] Disconnected — user:${userId} id:${socket.id} reason:${reason}`);
    });

    socket.on('error', (err) => {
      logger.error(`[Socket] Error on socket ${socket.id}:`, err);
    });
  });

  logger.info('[Socket] Socket.io server initialised');
  return io;
}

// ─────────────────────────────────────────────────────────────────────────────
// Emit Helpers
// Import these anywhere in the codebase (controllers, Redis consumer, etc.)
// to push events to all connected clients without importing `io` directly.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Broadcast a new alert to ALL authenticated clients.
 * Called by the Redis Streams consumer when the AI service returns a prediction.
 */
export function emitAlert(payload: AlertPayload): void {
  if (!io) {
    logger.warn('[Socket] emitAlert called before Socket.io was initialised');
    return;
  }
  io.to('viewer').emit('alert:new', payload);
  logger.debug(`[Socket] alert:new emitted — type:${payload.attackType} src:${payload.sourceIp}`);
}

/**
 * Broadcast updated traffic statistics to all connected clients.
 * Called by a periodic job (e.g. every 5 s) or after each batch of predictions.
 */
export function emitStats(payload: StatsPayload): void {
  if (!io) return;
  io.to('viewer').emit('stats:update', payload);
}

/**
 * Broadcast a capture session status change.
 * Called when an admin starts or stops the NIDS capture.
 */
export function emitCaptureStatus(payload: CaptureStatusPayload): void {
  if (!io) return;
  io.emit('capture:status', payload);
}

/** Returns the raw Socket.io server instance (use sparingly). */
export function getIO(): NidsServer {
  if (!io) throw new Error('Socket.io has not been initialised. Call initSocket() first.');
  return io;
}
