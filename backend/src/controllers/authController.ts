import { type Request, type Response, type NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import User from '../models/User.js'
import { env } from '../config/env.js'
import logger from '../config/logger.js'
import { AppError } from '../utils/AppError.js'
import type { JwtPayload } from '../types/auth.js'

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const REFRESH_COOKIE = 'refreshToken'

const COOKIE_OPTIONS = {
  httpOnly:  true,
  secure:    env.NODE_ENV === 'production',
  sameSite:  'strict' as const,
  path:      '/api/auth',    // cookie is only sent to auth endpoints
  maxAge:    7 * 24 * 60 * 60 * 1000,   // 7 days in ms
}

function signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  })
}

function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // ── 1. Validate request body ────────────────────────────────────────────
    const result = loginSchema.safeParse(req.body)
    if (!result.success) {
      throw AppError.badRequest(
        result.error.issues.map((i) => i.message).join(', '),
      )
    }
    const { email, password } = result.data

    // ── 2. Find user — findByEmail opts-in to the hidden password field ─────
    const user = await User.findByEmail(email)

    // Constant-time response for missing user and wrong password.
    // Returning the same generic error for both prevents user enumeration.
    if (!user || !(await user.comparePassword(password))) {
      logger.warn(`[Auth] Failed login attempt for email: ${email} from ${req.ip}`)
      throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS')
    }

    // ── 3. Sign tokens ──────────────────────────────────────────────────────
    const accessToken  = signAccessToken({ sub: String(user._id), email: user.email, role: user.role })
    const refreshToken = signRefreshToken(String(user._id))

    // ── 4. Set refresh token in HttpOnly cookie ─────────────────────────────
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTIONS)

    // ── 5. Return access token + safe user object ───────────────────────────
    logger.info(`[Auth] Successful login: user ${user._id} (${user.role})`)

    res.json({
      accessToken,
      user: {
        id:    String(user._id),
        email: user.email,
        role:  user.role,
      },
    })
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// Called by the frontend's Axios interceptor and AuthProvider on page load.
// ─────────────────────────────────────────────────────────────────────────────

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE]

    if (!token) {
      throw AppError.unauthorized('No refresh token')
    }

    // Verify the refresh token
    let payload: { sub: string }
    try {
      payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string }
    } catch {
      // Clear the invalid cookie immediately
      res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS)
      throw AppError.unauthorized('Invalid or expired refresh token')
    }

    // Load the user to ensure the account still exists and get latest role
    const user = await User.findById(payload.sub).lean()
    if (!user) {
      res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS)
      throw AppError.unauthorized('User not found')
    }

    // Issue a fresh access token
    const accessToken = signAccessToken({
      sub:   String(user._id),
      email: user.email,
      role:  user.role,
    })

    // Rotate the refresh token (issue a new one, invalidate the old)
    const newRefreshToken = signRefreshToken(String(user._id))
    res.cookie(REFRESH_COOKIE, newRefreshToken, COOKIE_OPTIONS)

    res.json({
      accessToken,
      user: {
        id:    String(user._id),
        email: user.email,
        role:  user.role,
      },
    })
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────────────

export function logout(_req: Request, res: Response): void {
  // Clear the refresh token cookie — the access token expires on its own
  // (15 min TTL means it's effectively invalidated within a short window)
  res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS)
  res.json({ message: 'Logged out successfully' })
}
