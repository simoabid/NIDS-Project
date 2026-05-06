import { type Request, type Response, type NextFunction } from 'express'
import type { Role } from '../types/auth.js'

// ─────────────────────────────────────────────────────────────────────────────
// authorize middleware factory
//
// Must be used AFTER authenticate — it assumes req.user is already populated.
//
// Usage:
//   // Allow any authenticated user:
//   router.get('/alerts', authenticate, handler)
//
//   // Restrict to admins only:
//   router.post('/capture/start', authenticate, authorize('admin'), handler)
//
//   // Allow multiple roles:
//   router.get('/stats', authenticate, authorize('admin', 'viewer'), handler)
// ─────────────────────────────────────────────────────────────────────────────

export function authorize(...allowedRoles: Role[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    // This should never be undefined if authenticate ran first, but guard anyway
    if (!req.user) {
      res.status(401).json({ status: 401, error: 'Not authenticated' })
      return
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        status: 403,
        error: `Forbidden — required role: ${allowedRoles.join(' or ')}`,
        yourRole: req.user.role,
      })
      return
    }

    next()
  }
}
