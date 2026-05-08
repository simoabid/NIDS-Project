import { type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import AuditLog from '../models/AuditLog.js'
import { AppError } from '../utils/AppError.js'

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const querySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(500).default(100),
  action: z.string().optional(),
  actor:  z.string().optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit-log — admin only, newest first
// ─────────────────────────────────────────────────────────────────────────────

export async function getAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = querySchema.safeParse(req.query)
    if (!result.success) {
      throw AppError.badRequest(
        result.error.issues.map((i) => i.message).join(', '),
      )
    }

    const { limit, action, actor } = result.data

    const filter: Record<string, unknown> = {}
    if (action) filter['action'] = action
    if (actor)  filter['actor']  = actor

    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    res.json({ logs, count: logs.length })
  } catch (err) {
    next(err)
  }
}
