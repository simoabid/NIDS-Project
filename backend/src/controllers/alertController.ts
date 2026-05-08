import { type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import Alert from '../models/Alert.js'
import { AppError } from '../utils/AppError.js'

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const paginationSchema = z.object({
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(100).default(20),
  attackType: z.enum(['Normal', 'DoS', 'PortScan', 'Unknown']).optional(),
  severity:   z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  status:     z.enum(['new', 'acknowledged', 'resolved', 'false_positive']).optional(),
  sourceIp:   z.string().optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alerts — paginated alert history
// ─────────────────────────────────────────────────────────────────────────────

export async function getAlerts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = paginationSchema.safeParse(req.query)
    if (!result.success) {
      throw AppError.badRequest(
        result.error.issues.map((i) => i.message).join(', '),
      )
    }

    const { page, limit, attackType, severity, status, sourceIp } = result.data

    // Build filter — only include fields that were provided
    const filter: Record<string, unknown> = {}
    if (attackType) filter['attackType'] = attackType
    if (severity)   filter['severity']   = severity
    if (status)     filter['status']     = status
    if (sourceIp)   filter['sourceIp']   = sourceIp

    const skip = (page - 1) * limit

    // Run query + count in parallel for performance
    const [alerts, total] = await Promise.all([
      Alert.find(filter)
        .sort({ timestamp: -1 })     // newest first
        .skip(skip)
        .limit(limit)
        .lean(),
      Alert.countDocuments(filter),
    ])

    res.json({
      alerts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alerts/:id — single alert detail
// ─────────────────────────────────────────────────────────────────────────────

export async function getAlertById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const alert = await Alert.findById(req.params['id']).lean()
    if (!alert) throw AppError.notFound('Alert not found')
    res.json(alert)
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/alerts/:id/status — update alert status (admin only)
// ─────────────────────────────────────────────────────────────────────────────

const statusUpdateSchema = z.object({
  status: z.enum(['acknowledged', 'resolved', 'false_positive']),
})

export async function updateAlertStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = statusUpdateSchema.safeParse(req.body)
    if (!result.success) {
      throw AppError.badRequest(
        result.error.issues.map((i) => i.message).join(', '),
      )
    }

    const update: Record<string, unknown> = {
      status: result.data.status,
    }

    // Track who acknowledged and when
    if (result.data.status === 'acknowledged') {
      update['acknowledgedBy'] = req.user?.sub ?? null
      update['acknowledgedAt'] = new Date()
    }

    const alert = await Alert.findByIdAndUpdate(
      req.params['id'],
      { $set: update },
      { new: true, runValidators: true },
    ).lean()

    if (!alert) throw AppError.notFound('Alert not found')

    res.json(alert)
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alerts/stats — aggregated alert statistics
// ─────────────────────────────────────────────────────────────────────────────

export async function getAlertStats(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [byType, bySeverity, byStatus, total, recentCount] = await Promise.all([
      Alert.aggregate([
        { $group: { _id: '$attackType', count: { $sum: 1 } } },
      ]),
      Alert.aggregate([
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]),
      Alert.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Alert.countDocuments(),
      // Alerts in the last 24 hours
      Alert.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
    ])

    res.json({
      total,
      last24h: recentCount,
      byAttackType: Object.fromEntries(byType.map((r) => [r['_id'], r['count']])),
      bySeverity:   Object.fromEntries(bySeverity.map((r) => [r['_id'], r['count']])),
      byStatus:     Object.fromEntries(byStatus.map((r) => [r['_id'], r['count']])),
    })
  } catch (err) {
    next(err)
  }
}
