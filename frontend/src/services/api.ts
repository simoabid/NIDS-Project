// ─────────────────────────────────────────────────────────────────────────────
// Axios HTTP client
// src/services/api.ts
// ─────────────────────────────────────────────────────────────────────────────

import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { tokenStore } from '@/store/tokenStore'

// Extend Axios config type to allow our custom skipAuthRetry flag
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    skipAuthRetry?: boolean
  }
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',   // '' → same origin (Vite proxy in dev)
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
})

// ── Request interceptor — attach Bearer token from memory ────────────────────
// Reads from tokenStore (a module variable), never from localStorage.
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.get()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Response interceptor — handle 401 globally ────────────────────────────────
// On a 401 the access token has expired.
// If a refresh endpoint is available, attempt a silent token refresh once.
// If that also fails (or skipAuthRetry is set), wipe the token and let the
// PrivateRoute / AuthContext handle the redirect to /login.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig | undefined

    if (
      error.response?.status === 401 &&
      original &&
      !original.skipAuthRetry
    ) {
      original.skipAuthRetry = true   // prevent infinite retry loops

      try {
        // Attempt silent refresh using the HttpOnly cookie
        const refreshConfig: InternalAxiosRequestConfig = {
          withCredentials: true,
          skipAuthRetry: true,
          headers: api.defaults.headers as never,
        }
        const { data } = await api.post<{ accessToken: string }>(
          '/api/auth/refresh',
          {},
          refreshConfig,
        )

        tokenStore.set(data.accessToken)

        // Retry the original request with the new token
        original.headers.Authorization = `Bearer ${data.accessToken}`
        return api(original)
      } catch {
        // Refresh also failed — clear the token and let AuthContext handle it
        tokenStore.clear()
        // Dispatch a custom event so AuthContext can react without a circular import
        window.dispatchEvent(new Event('auth:expired'))
      }
    }

    return Promise.reject(error)
  },
)

export default api
