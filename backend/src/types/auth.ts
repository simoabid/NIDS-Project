// ─────────────────────────────────────────────────────────────────────────────
// Shared auth types
// src/types/auth.ts
//
// Imported by middleware, controllers, and services — single definition so
// the JWT payload shape never diverges across the codebase.
// ─────────────────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'viewer'

/** Shape of the data encoded inside every access token. */
export interface JwtPayload {
  /** MongoDB user _id as a string */
  sub: string
  /** User's email — included for logging without an extra DB lookup */
  email: string
  role: Role
  /** Standard JWT issued-at — set automatically by jwt.sign() */
  iat?: number
  /** Standard JWT expiry — set automatically by jwt.sign() */
  exp?: number
}
