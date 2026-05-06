// ─────────────────────────────────────────────────────────────────────────────
// AppError — typed HTTP error
// src/utils/AppError.ts
//
// Throw AppError anywhere in the request lifecycle.
// The global error handler in app.ts catches it and converts it to a JSON
// response with the correct status code automatically.
// ─────────────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    /** HTTP status code to send to the client */
    public readonly statusCode: number,
    /** Human-readable error message (stripped in production for 5xx) */
    message: string,
    /**
     * Optional machine-readable code for the frontend to act on.
     * e.g. 'TOKEN_EXPIRED', 'INVALID_CREDENTIALS'
     */
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'AppError'
    // Restore prototype chain — required when extending built-in classes
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /** Convenience factories */
  static badRequest(message: string, code?: string) {
    return new AppError(400, message, code)
  }

  static unauthorized(message = 'Unauthorized', code?: string) {
    return new AppError(401, message, code)
  }

  static forbidden(message = 'Forbidden') {
    return new AppError(403, message)
  }

  static notFound(message = 'Not found') {
    return new AppError(404, message)
  }
}
