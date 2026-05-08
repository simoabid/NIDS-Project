// ─────────────────────────────────────────────────────────────────────────────
// Stats Broadcaster — periodic Socket.io push
// backend/src/services/statsBroadcaster.ts
//
// Queries MongoDB every INTERVAL_MS and emits stats:update to all connected
// dashboard clients. This keeps charts fresh even when no new alerts arrive.
// ─────────────────────────────────────────────────────────────────────────────

import Alert from '../models/Alert.js'
import captureService from './captureService.js'
import { emitStats } from './socketService.js'
import logger from '../config/logger.js'
import type { StatsPayload } from '../types/events.js'

const INTERVAL_MS = 10_000   // 10 seconds

let timer: ReturnType<typeof setInterval> | null = null

// ─────────────────────────────────────────────────────────────────────────────
// Start / Stop
// ─────────────────────────────────────────────────────────────────────────────

export function startStatsBroadcaster(): void {
  if (timer) return                   // already running

  // Fire once immediately so the dashboard doesn't wait 10s on first load
  void broadcastStats()

  timer = setInterval(() => {
    void broadcastStats()
  }, INTERVAL_MS)

  logger.info('[Stats] Broadcaster started (every %ds)', INTERVAL_MS / 1000)
}

export function stopStatsBroadcaster(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    logger.info('[Stats] Broadcaster stopped')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query + emit
// ─────────────────────────────────────────────────────────────────────────────

async function broadcastStats(): Promise<void> {
  try {
    // Single aggregation pipeline — one DB round-trip for all metrics
    const [result] = await Alert.aggregate<{
      counts: Array<{ _id: string; count: number; avgConf: number }>
      total: number
    }>([
      {
        $facet: {
          // Total counts by attack type
          counts: [
            {
              $group: {
                _id: '$attackType',
                count: { $sum: 1 },
                avgConf: { $avg: '$confidence' },
              },
            },
          ],
          // Overall total
          total: [{ $count: 'n' }],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ['$total.n', 0] }, 0] },
          counts: 1,
        },
      },
    ])

    const counts = result?.counts ?? []
    const total = result?.total ?? 0

    // Derive metrics from the aggregation
    let normal = 0
    let attacks = 0
    let attackConfSum = 0
    let attackConfCount = 0
    let topType = 'None'
    let topCount = 0

    for (const bucket of counts) {
      const c = bucket.count as number
      if (bucket._id === 'Normal') {
        normal = c
      } else {
        attacks += c
        attackConfSum += (bucket.avgConf as number) * c
        attackConfCount += c
        if (c > topCount) {
          topCount = c
          topType = bucket._id as string
        }
      }
    }

    const payload: StatsPayload = {
      totalPackets:   total,
      normalCount:    normal,
      attackCount:    attacks,
      detectionRate:  total > 0 ? Math.round((attacks / total) * 10000) / 100 : 0,
      avgConfidence:  attackConfCount > 0
        ? Math.round((attackConfSum / attackConfCount) * 10000) / 100
        : 0,
      topAttackType:  topType,
      captureActive:  captureService.isActive,
      timestamp:      new Date().toISOString(),
    }

    emitStats(payload)
  } catch (err) {
    logger.error('[Stats] Broadcast error: %s', (err as Error).message)
  }
}
