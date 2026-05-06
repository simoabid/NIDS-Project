import { type Request, type Response, type NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import logger from '../config/logger.js'
import type { JwtPayload } from '../types/auth.js'

// ─────────────────────────────────────────────────────────────────────────────
// authenticate middleware
//
// Usage:
//   router.get('/protected', authenticate, handler)
//   router.use('/api/alerts', authenticate, alertsRouter)
//
// What it does:
//   1. Extracts the token from the Authorization header (Bearer scheme)
//   2. Verifies the signature and expiry against JWT_SECRET
//   3. Attaches the decoded payload to req.user
//   4. Calls next() on success, sends 401 on any failure
//
// What it does NOT do:
//   • Role checking — that is the job of the authorize() middleware
//   • Refresh tokens — those are handled by /api/auth/refresh
// ─────────────────────────────────────────────────────────────────────────────

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization

  // ── 1. Header present and well-formed? ───────────────────────────────────
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      status: 401,
      error: 'Authorization header missing or malformed',
      hint:  'Expected: Authorization: Bearer <token>',
    })
    return
  }

  const token = authHeader.slice(7)   // strip "Bearer " prefix

  // ── 2. Verify signature and expiry ───────────────────────────────────────
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload

    // Sanity-check that the payload has the fields we expect.
    // Prevents a crafted token with missing claims from reaching a controller.
    if (!decoded.sub || !decoded.role) {
      res.status(401).json({ status: 401, error: 'Token payload is invalid' })
      return
    }

    req.user = decoded
    next()
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      logger.debug(`[Auth] Expired token from ${req.ip}`)
      res.status(401).json({
        status: 401,
        error: 'Token expired',
        code:  'TOKEN_EXPIRED',    // frontend uses this code to trigger a silent refresh
      })
      return
    }

    if (err instanceof jwt.JsonWebTokenError) {
      logger.warn(`[Auth] Invalid JWT from ${req.ip}: ${err.message}`)
      res.status(401).json({ status: 401, error: 'Invalid token' })
      return
    }

    // Unknown error — log and return 500
    logger.error('[Auth] Unexpected JWT verification error', err)
    res.status(500).json({ status: 500, error: 'Internal server error' })
  }
}
