// ── Login Page ────────────────────────────────────────────────────────────────
// Wires the Phase 1 login skeleton to the real auth API.
// Stores the access token in memory (tokenStore), connects Socket.io,
// and redirects to the page the user was trying to reach.
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { Shield, Mail, Lock, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react'
import { useAuth, type AuthUser } from '@/context/AuthContext'
import api from '@/services/api'

// ── Component ─────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { login, isAuthenticated, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Form state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Feedback state
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [shake, setShake] = useState(false)

  // Refs
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  // Redirect if the user is already authenticated
  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthenticated, authLoading, navigate])

  // Auto-focus email input on mount
  useEffect(() => {
    if (!authLoading) emailRef.current?.focus()
  }, [authLoading])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function clearError() {
    if (error) setError('')
  }

  function triggerShake() {
    setShake(true)
    setTimeout(() => setShake(false), 450)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')

    const trimmedEmail = email.trim()

    // Client-side guard
    if (!trimmedEmail || !password) {
      setError('Please enter your email and password.')
      if (!trimmedEmail) emailRef.current?.focus()
      else passwordRef.current?.focus()
      triggerShake()
      return
    }

    setIsSubmitting(true)

    try {
      const { data } = await api.post<{ accessToken: string; user: AuthUser }>(
        '/api/auth/login',
        { email: trimmedEmail, password },
        { withCredentials: true },
      )

      // Store token in memory, connect Socket.io, update AuthContext
      login(data.accessToken, data.user)

      // Navigate to the page the user originally requested (set by PrivateRoute)
      const from = (location.state as { from?: string } | null)?.from ?? '/dashboard'
      navigate(from, { replace: true })
    } catch (err: unknown) {
      if (isAxiosError(err)) {
        const status = err.response?.status
        if (status === 401) {
          setError('Invalid email or password.')
        } else if (status === 429) {
          setError('Too many attempts. Please wait and try again.')
        } else {
          setError('Something went wrong. Please try again.')
        }
      } else {
        setError('Unable to connect to the server.')
      }
      triggerShake()
      passwordRef.current?.focus()
      passwordRef.current?.select()
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Auth-loading spinner ──────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-surface-900">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh flex items-center justify-center bg-surface-900 relative overflow-hidden px-4">
      {/* Ambient background glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] rounded-full bg-brand-500/[0.05] blur-[100px]"
      />

      {/* Card */}
      <div className={`relative w-full max-w-[400px] animate-fade-in-up ${shake ? 'animate-shake' : ''}`}>
        <div className="bg-surface-800/80 backdrop-blur-xl border border-surface-700/50 rounded-2xl p-8 shadow-2xl shadow-black/25">

          {/* ── Header ─────────────────────────────────────────────────── */}
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-brand-500/10 border border-brand-500/20 mb-4">
              <Shield className="h-6 w-6 text-brand-500" />
            </div>
            <h1 className="text-xl font-semibold text-white tracking-tight">
              Sign in to <span className="text-brand-500">NIDS</span>
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Network Intrusion Detection System
            </p>
          </div>

          {/* ── Error banner ───────────────────────────────────────────── */}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3 mb-6 rounded-lg bg-danger-500/10 border border-danger-500/20 text-danger-500 text-sm animate-fade-in-up"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Form ───────────────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>

            {/* Email */}
            <div>
              <label
                htmlFor="login-email"
                className="block text-sm font-medium text-slate-300 mb-1.5"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                <input
                  ref={emailRef}
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); clearError() }}
                  disabled={isSubmitting}
                  placeholder="admin@nids.local"
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-surface-700/50 border border-surface-700 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-slate-300 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                <input
                  ref={passwordRef}
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError() }}
                  disabled={isSubmitting}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 rounded-lg bg-surface-700/50 border border-surface-700 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 focus:text-slate-300 focus:outline-none transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword
                    ? <EyeOff className="h-4 w-4" />
                    : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 mt-1 rounded-lg bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:ring-offset-2 focus:ring-offset-surface-800"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Signing in…</span>
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {/* ── Footer ─────────────────────────────────────────────────── */}
          <p className="text-center text-xs text-slate-600 mt-6 select-none">
            Secured with JWT · HttpOnly cookies
          </p>
        </div>
      </div>
    </div>
  )
}
