// ─────────────────────────────────────────────────────────────────────────────
// Auth Context
// src/context/AuthContext.tsx
//
// Single source of truth for authentication state across the app.
//
// Flow:
//   1. On mount, AuthProvider attempts a silent token refresh via the
//      HttpOnly refresh-token cookie.  While this is in-flight, isLoading=true
//      and PrivateRoute shows a spinner instead of redirecting to /login.
//   2. On login(), the access token is stored in memory (tokenStore) and user
//      info is stored in React state. The backend sets the refresh-token cookie.
//   3. On logout(), the token and user are cleared and the backend invalidates
//      the refresh-token cookie.
//   4. The Axios interceptor in api.ts reads from tokenStore directly, so it
//      always has the latest token without needing context.
// ─────────────────────────────────────────────────────────────────────────────

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import api from '@/services/api'
import { tokenStore } from '@/store/tokenStore'
import { connectSocket, disconnectSocket } from '@/services/socket'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  role: 'admin' | 'viewer'
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean          // true during the initial silent-refresh attempt
}

interface AuthContextValue extends AuthState {
  /** Call after a successful /api/auth/login response. */
  login: (accessToken: string, user: AuthUser) => void
  /** Clear state, wipe token, disconnect socket, call /api/auth/logout. */
  logout: () => Promise<void>
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,   // start loading until the refresh attempt completes
  })

  // Track whether the component is still mounted before setting state
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── Listen for token expiry events from the Axios interceptor ─────────────
  // The interceptor dispatches 'auth:expired' when a silent refresh fails.
  // We can't import logout() from here into api.ts (circular dep), so we
  // use a custom DOM event as a decoupled signalling mechanism instead.
  useEffect(() => {
    const handleExpired = () => {
      tokenStore.clear()
      disconnectSocket()
      if (mountedRef.current) {
        setState({ user: null, isAuthenticated: false, isLoading: false })
      }
    }

    window.addEventListener('auth:expired', handleExpired)
    return () => window.removeEventListener('auth:expired', handleExpired)
  }, [])

  // ── Silent refresh on mount ──────────────────────────────────────────────
  // Attempts to recover the session using the HttpOnly refresh-token cookie.
  // If the user just opened the app after a previous login, the cookie is
  // present and the server returns a fresh access token.
  useEffect(() => {
    let cancelled = false

    async function attemptSilentRefresh() {
      try {
        const { data } = await api.post<{ accessToken: string; user: AuthUser }>(
          '/api/auth/refresh',
          {},
          {
            withCredentials: true,   // send the HttpOnly refresh-token cookie
            skipAuthRetry: true,     // custom flag — prevents infinite loop on 401
          } as Parameters<typeof api.post>[2],
        )

        if (cancelled || !mountedRef.current) return

        tokenStore.set(data.accessToken)
        connectSocket(data.accessToken)
        setState({ user: data.user, isAuthenticated: true, isLoading: false })
      } catch {
        // No valid refresh token (first visit, cookie expired, logged out)
        if (!cancelled && mountedRef.current) {
          setState({ user: null, isAuthenticated: false, isLoading: false })
        }
      }
    }

    void attemptSilentRefresh()
    return () => { cancelled = true }
  }, [])

  // ── login ────────────────────────────────────────────────────────────────
  const login = useCallback((accessToken: string, user: AuthUser) => {
    tokenStore.set(accessToken)
    connectSocket(accessToken)
    setState({ user, isAuthenticated: true, isLoading: false })
  }, [])

  // ── logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    // Optimistically clear local state first for instant UI response
    tokenStore.clear()
    disconnectSocket()
    setState({ user: null, isAuthenticated: false, isLoading: false })

    // Tell the backend to invalidate and clear the refresh-token cookie
    try {
      await api.post('/api/auth/logout', {}, { withCredentials: true })
    } catch {
      // Ignore network errors — the local state is already cleared
    }
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// ── useAuth hook ──────────────────────────────────────────────────────────────

/**
 * Consume the auth context.
 * Throws if used outside of <AuthProvider> — fails fast during development.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>')
  }
  return ctx
}
