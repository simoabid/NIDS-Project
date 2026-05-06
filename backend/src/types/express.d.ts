// ─────────────────────────────────────────────────────────────────────────────
// Express Request augmentation
// src/types/express.d.ts
//
// Adds `req.user` to every Express Request so TypeScript knows the property
// exists after the `authenticate` middleware has run.
// ─────────────────────────────────────────────────────────────────────────────

import type { JwtPayload } from './auth.js'

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by the `authenticate` middleware after a valid JWT is verified.
       * Undefined on unauthenticated routes.
       */
      user?: JwtPayload
    }
  }
}

// This file must be a module (not a script) for declaration merging to work.
export {}
