import { Router } from 'express'
import { authenticate } from '../middleware/authenticate.js'
import { authorize } from '../middleware/authorize.js'
import {
  startCapture,
  stopCapture,
  processPcap,
  getCaptureStatus,
} from '../controllers/captureController.js'

// ─────────────────────────────────────────────────────────────────────────────
// Capture router  →  mounted at /api/capture in app.ts
// ─────────────────────────────────────────────────────────────────────────────

const router = Router()

// All capture routes require authentication
router.use(authenticate)

/** GET /api/capture/status — any authenticated user can check capture state */
router.get('/status', getCaptureStatus)

/** POST /api/capture/start — admin only */
router.post('/start', authorize('admin'), startCapture)

/** POST /api/capture/stop — admin only */
router.post('/stop', authorize('admin'), stopCapture)

/** POST /api/capture/pcap — admin only */
router.post('/pcap', authorize('admin'), processPcap)

export default router
