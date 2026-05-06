import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { login, refresh, logout } from '../controllers/authController.js'
import { authenticate } from '../middleware/authenticate.js'

// ─────────────────────────────────────────────────────────────────────────────
// Auth router  →  mounted at /api/auth in app.ts
// ─────────────────────────────────────────────────────────────────────────────

const router = Router()

// ── Strict rate limiter for auth endpoints ────────────────────────────────────
// 5 attempts per 15 minutes per IP — mitigates brute-force attacks.
// This is applied ON TOP of the global limiter in app.ts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    error:  'Too many login attempts. Please wait 15 minutes and try again.',
    code:   'RATE_LIMITED',
  },
  skipSuccessfulRequests: true,   // only count failed attempts toward the limit
})

// ── Routes ────────────────────────────────────────────────────────────────────

/** Public — validate credentials, receive access token + set refresh cookie */
router.post('/login',   authLimiter, login)

/** Public — exchange refresh cookie for a new access token */
router.post('/refresh', refresh)

/** Protected — clears the refresh cookie (access token expires on its own) */
router.post('/logout',  authenticate, logout)

export default router
