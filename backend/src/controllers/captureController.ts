import { type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import captureService from '../services/captureService.js'
import { emitCaptureStatus } from '../services/socketService.js'
import AuditLog from '../models/AuditLog.js'
import logger from '../config/logger.js'
import { AppError } from '../utils/AppError.js'

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const startSchema = z.object({
  interface: z.string().min(1, 'Network interface name is required'),
})

const pcapSchema = z.object({
  pcapPath: z.string().min(1, 'Pcap file path is required'),
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/capture/start — start live capture (admin only)
// ─────────────────────────────────────────────────────────────────────────────

export async function startCapture(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (captureService.isActive) {
      throw AppError.badRequest('Capture is already running — stop it first')
    }

    const result = startSchema.safeParse(req.body)
    if (!result.success) {
      throw AppError.badRequest(
        result.error.issues.map((i) => i.message).join(', '),
      )
    }

    const { interface: iface } = result.data

    await captureService.startLive(iface)

    // Broadcast status change to all dashboard clients
    emitCaptureStatus(captureService.statusPayload)

    // Audit log
    void AuditLog.record({
      actor:      req.user?.sub ?? null,
      actorEmail: req.user?.email ?? null,
      actorRole:  req.user?.role ?? 'admin',
      action:     'capture:start',
      targetId:   iface,
      targetType: 'capture',
      metadata:   { interface: iface, mode: 'live' },
      ipAddress:  req.ip ?? null,
    })

    logger.info('[Capture] Started by %s on interface %s', req.user?.email, iface)

    res.json({
      message: `Capture started on ${iface}`,
      status:  captureService.statusPayload,
      stats:   captureService.stats,
    })
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/capture/stop — stop active capture (admin only)
// ─────────────────────────────────────────────────────────────────────────────

export async function stopCapture(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!captureService.isActive) {
      throw AppError.badRequest('No capture is currently running')
    }

    const finalStats = captureService.stats
    captureService.stop()

    // Broadcast status change to all dashboard clients
    emitCaptureStatus(captureService.statusPayload)

    // Audit log
    void AuditLog.record({
      actor:      req.user?.sub ?? null,
      actorEmail: req.user?.email ?? null,
      actorRole:  req.user?.role ?? 'admin',
      action:     'capture:stop',
      targetId:   null,
      targetType: 'capture',
      metadata:   { finalStats },
      ipAddress:  req.ip ?? null,
    })

    logger.info('[Capture] Stopped by %s', req.user?.email)

    res.json({
      message: 'Capture stopped',
      status:  captureService.statusPayload,
      stats:   finalStats,
    })
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/capture/pcap — process a pcap file (admin only)
// ─────────────────────────────────────────────────────────────────────────────

export async function processPcap(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (captureService.isActive) {
      throw AppError.badRequest('Capture is already running — stop it first')
    }

    const result = pcapSchema.safeParse(req.body)
    if (!result.success) {
      throw AppError.badRequest(
        result.error.issues.map((i) => i.message).join(', '),
      )
    }

    await captureService.processPcap(result.data.pcapPath)

    emitCaptureStatus(captureService.statusPayload)

    void AuditLog.record({
      actor:      req.user?.sub ?? null,
      actorEmail: req.user?.email ?? null,
      actorRole:  req.user?.role ?? 'admin',
      action:     'capture:upload',
      targetId:   result.data.pcapPath,
      targetType: 'capture',
      metadata:   { pcapPath: result.data.pcapPath, mode: 'pcap' },
      ipAddress:  req.ip ?? null,
    })

    res.json({
      message: `Processing pcap: ${result.data.pcapPath}`,
      status:  captureService.statusPayload,
      stats:   captureService.stats,
    })
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/capture/status — current capture state (any authenticated user)
// ─────────────────────────────────────────────────────────────────────────────

export function getCaptureStatus(
  _req: Request,
  res: Response,
): void {
  res.json({
    status: captureService.statusPayload,
    stats:  captureService.stats,
  })
}
