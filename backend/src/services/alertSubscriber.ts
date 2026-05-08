// ─────────────────────────────────────────────────────────────────────────────
// Alert Subscriber — AI Service → Backend → Socket.io
// backend/src/services/alertSubscriber.ts
//
// The AI service publishes AlertPayload JSON to the Redis "alerts" pub/sub
// channel every time it classifies a flow. This subscriber:
//   1. Saves the alert to MongoDB (persistence for history/analytics)
//   2. Writes an audit log entry (PFE spec: "décisions du modèle")
//   3. Emits alert:new via Socket.io (real-time dashboard push)
//
// Uses a DEDICATED ioredis connection because once you call .subscribe()
// the connection enters subscriber mode and can only handle pub/sub commands.
// The main redis client (config/redis.ts) stays free for XADD, GET, etc.
// ─────────────────────────────────────────────────────────────────────────────

import Redis from 'ioredis'
import { env } from '../config/env.js'
import logger from '../config/logger.js'
import Alert from '../models/Alert.js'
import AuditLog from '../models/AuditLog.js'
import { emitAlert } from './socketService.js'
import type { AlertPayload } from '../types/events.js'

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const ALERT_CHANNEL = process.env['REDIS_ALERT_CHANNEL'] ?? 'alerts'

// ─────────────────────────────────────────────────────────────────────────────
// Subscriber state
// ─────────────────────────────────────────────────────────────────────────────

let subscriber: Redis | null = null

/** Running stats — exposed via /api/health */
const stats = {
  received: 0,
  saved: 0,
  emitted: 0,
  errors: 0,
}

// ─────────────────────────────────────────────────────────────────────────────
// Start / Stop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a dedicated Redis connection, subscribe to the alerts channel,
 * and wire up the message handler.
 *
 * Call this AFTER connectRedis() and initSocket() in the boot sequence.
 */
export async function startAlertSubscriber(): Promise<void> {
  // Dedicated connection — separate from the main redis client
  subscriber = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,   // infinite retries for long-lived subscriber
    enableReadyCheck: true,
    lazyConnect: true,
  })

  subscriber.on('error', (err) => {
    logger.error('[AlertSub] Redis subscriber error:', err)
    stats.errors++
  })

  subscriber.on('reconnecting', () => {
    logger.warn('[AlertSub] Redis subscriber reconnecting…')
  })

  await subscriber.connect()

  // Subscribe to the alerts channel
  await subscriber.subscribe(ALERT_CHANNEL)
  logger.info(`[AlertSub] Subscribed to Redis channel "${ALERT_CHANNEL}"`)

  // Handle incoming messages
  subscriber.on('message', (channel: string, message: string) => {
    if (channel !== ALERT_CHANNEL) return
    void handleAlertMessage(message)
  })
}

/**
 * Cleanly disconnect the subscriber on shutdown.
 */
export async function stopAlertSubscriber(): Promise<void> {
  if (subscriber) {
    await subscriber.unsubscribe(ALERT_CHANNEL)
    await subscriber.quit()
    subscriber = null
    logger.info(
      '[AlertSub] Stopped — received: %d, saved: %d, emitted: %d, errors: %d',
      stats.received, stats.saved, stats.emitted, stats.errors,
    )
  }
}

/** Return subscriber stats for the health endpoint */
export function getSubscriberStats(): typeof stats {
  return { ...stats }
}

// ─────────────────────────────────────────────────────────────────────────────
// Message handler — the core pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function handleAlertMessage(raw: string): Promise<void> {
  stats.received++

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    logger.error('[AlertSub] Failed to parse alert JSON: %s', raw.slice(0, 200))
    stats.errors++
    return
  }

  try {
    // Validate attackType against allowed values before passing to Mongoose
    const rawAttack = String(parsed['attackType'] ?? 'Unknown')
    const VALID_ATTACKS = ['Normal', 'DoS', 'PortScan', 'Unknown'] as const
    type AttackType = typeof VALID_ATTACKS[number]
    const attackType: AttackType = VALID_ATTACKS.includes(rawAttack as AttackType)
      ? (rawAttack as AttackType)
      : 'Unknown'

    const alert = await Alert.create({
      sourceIp:        String(parsed['sourceIp']        ?? '0.0.0.0'),
      destinationIp:   String(parsed['destinationIp']   ?? '0.0.0.0'),
      sourcePort:      Number(parsed['sourcePort']      ?? 0),
      destinationPort: Number(parsed['destinationPort'] ?? 0),
      protocol:        String(parsed['protocol']        ?? 'TCP'),
      attackType,
      confidence:      Number(parsed['confidence']       ?? 0),
      packetSize:      Number(parsed['packetSize']       ?? 0),
      timestamp:       new Date(String(parsed['timestamp'] ?? new Date().toISOString())),
      // severity is auto-derived by the pre-save hook in Alert.ts
    })
    stats.saved++

    // ── 2. Build the Socket.io payload ────────────────────────────────────
    const payload: AlertPayload = {
      id:              String(alert._id),
      sourceIp:        alert.sourceIp,
      destinationIp:   alert.destinationIp,
      sourcePort:      alert.sourcePort,
      destinationPort: alert.destinationPort,
      protocol:        alert.protocol,
      attackType:      alert.attackType as AlertPayload['attackType'],
      confidence:      alert.confidence,
      packetSize:      alert.packetSize,
      timestamp:       alert.timestamp.toISOString(),
    }

    // ── 3. Emit to all connected dashboard clients ────────────────────────
    emitAlert(payload)
    stats.emitted++

    // ── 4. Audit log — track AI model decisions ───────────────────────────
    const isAttack = alert.attackType !== 'Normal'
    void AuditLog.record({
      actor:      null,
      actorEmail: null,
      actorRole:  'system',
      action:     isAttack ? 'ai:detection' : 'ai:prediction',
      targetId:   String(alert._id),
      targetType: 'prediction',
      metadata: {
        attackType:  alert.attackType,
        confidence:  alert.confidence,
        severity:    alert.severity,
        sourceIp:    alert.sourceIp,
        destinationIp: alert.destinationIp,
      },
      ipAddress: null,
    })

    // Log attacks at INFO, normal traffic at DEBUG
    if (isAttack) {
      logger.info(
        '[AlertSub] 🚨 %s (%.0f%%) %s:%d → %s:%d — saved as %s',
        alert.attackType, alert.confidence * 100,
        alert.sourceIp, alert.sourcePort,
        alert.destinationIp, alert.destinationPort,
        alert._id,
      )
    } else {
      logger.debug(
        '[AlertSub] ✓ Normal (%.0f%%) %s → %s',
        alert.confidence * 100, alert.sourceIp, alert.destinationIp,
      )
    }

  } catch (err) {
    logger.error('[AlertSub] Failed to process alert: %s', (err as Error).message)
    stats.errors++
  }
}
