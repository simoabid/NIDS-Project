// ─────────────────────────────────────────────────────────────────────────────
// PrivateRoute
// src/components/PrivateRoute.tsx
//
// Wraps any route that requires authentication.
//
// States:
//   isLoading=true   → show a full-screen spinner while the silent refresh runs
//   !isAuthenticated → redirect to /login, preserving the intended destination
//                      so the user lands back after a successful login
//   isAuthenticated  → render the protected children
// ─────────────────────────────────────────────────────────────────────────────

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

interface PrivateRouteProps {
  children: React.ReactNode
  /** Restrict to a specific role. Omit to allow any authenticated user. */
  requiredRole?: 'admin' | 'viewer'
}

export default function PrivateRoute({ children, requiredRole }: PrivateRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth()
  const location = useLocation()

  // ── 1. Silent refresh in progress ────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-900">
        <div className="flex flex-col items-center gap-4">
          {/* Spinning shield icon */}
          <span className="text-4xl animate-spin">🛡️</span>
          <p className="text-sm text-slate-400 tracking-wide">Verifying session…</p>
        </div>
      </div>
    )
  }

  // ── 2. Not authenticated → redirect to /login ─────────────────────────────
  // `state.from` preserves the URL the user was trying to reach so LoginPage
  // can redirect back after a successful login instead of always going to /.
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // ── 3. Authenticated but wrong role ──────────────────────────────────────
  if (requiredRole && user?.role !== requiredRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-900">
        <div className="text-center">
          <p className="text-2xl mb-2">🚫</p>
          <p className="text-slate-300 font-medium">Access denied</p>
          <p className="text-sm text-slate-500 mt-1">
            This page requires the <code className="text-brand-500">{requiredRole}</code> role.
          </p>
        </div>
      </div>
    )
  }

  // ── 4. All checks passed ──────────────────────────────────────────────────
  return <>{children}</>
}
