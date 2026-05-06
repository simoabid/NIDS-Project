// ─────────────────────────────────────────────────────────────────────────────
// In-memory token store
// src/store/tokenStore.ts
//
// The access token is held in a plain module-level variable — never written to
// localStorage, sessionStorage, or a cookie accessible by JavaScript.
//
// Why this is safer:
//   • XSS attacks can call localStorage.getItem() but CANNOT read a JS module
//     variable from a different scope.
//   • The token is automatically cleared when the tab/window is closed or the
//     page is hard-refreshed (intentional — recovered via refresh token cookie).
//
// The refresh token is stored in an HttpOnly, Secure, SameSite=Strict cookie
// set by the backend. JavaScript has zero access to it — only the browser
// sends it automatically on requests to the /api/auth/refresh endpoint.
// ─────────────────────────────────────────────────────────────────────────────

let _accessToken: string | null = null

export const tokenStore = {
  /** Read the current in-memory access token. */
  get(): string | null {
    return _accessToken
  },

  /** Store a new access token after a successful login or token refresh. */
  set(token: string): void {
    _accessToken = token
  },

  /** Wipe the token on logout or on a 401 response. */
  clear(): void {
    _accessToken = null
  },

  /** Returns true if a token is currently held in memory. */
  hasToken(): boolean {
    return _accessToken !== null
  },
}
