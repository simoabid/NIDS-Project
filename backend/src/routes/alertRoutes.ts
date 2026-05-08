import { Router } from 'express'
import { authenticate } from '../middleware/authenticate.js'
import { authorize } from '../middleware/authorize.js'
import {
  getAlerts,
  getAlertById,
  getAlertStats,
  updateAlertStatus,
} from '../controllers/alertController.js'

// ─────────────────────────────────────────────────────────────────────────────
// Alert router  →  mounted at /api/alerts in app.ts
// ─────────────────────────────────────────────────────────────────────────────

const router = Router()

// All alert routes require authentication
router.use(authenticate)

/** GET /api/alerts/stats — aggregated statistics (must be before /:id) */
router.get('/stats', getAlertStats)

/** GET /api/alerts — paginated list with optional filters */
router.get('/', getAlerts)

/** GET /api/alerts/:id — single alert detail */
router.get('/:id', getAlertById)

/** PATCH /api/alerts/:id/status — update alert lifecycle (admin only) */
router.patch('/:id/status', authorize('admin'), updateAlertStatus)

export default router
