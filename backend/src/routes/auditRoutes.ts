import { Router } from 'express'
import { authenticate } from '../middleware/authenticate.js'
import { authorize } from '../middleware/authorize.js'
import { getAuditLogs } from '../controllers/auditController.js'

// ─────────────────────────────────────────────────────────────────────────────
// Audit-log router  →  mounted at /api/audit-log in app.ts
// ─────────────────────────────────────────────────────────────────────────────

const router = Router()

// Admin only — viewers must never see raw audit data
router.use(authenticate, authorize('admin'))

/** GET /api/audit-log — last 100 entries, newest first */
router.get('/', getAuditLogs)

export default router
