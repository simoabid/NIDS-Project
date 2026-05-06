import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import PrivateRoute from '@/components/PrivateRoute'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'

// ─────────────────────────────────────────────────────────────────────────────
// App — root router
//
// AuthProvider must wrap BrowserRouter so that any route component can call
// useAuth() and so that the silent refresh runs before any route renders.
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* ── Public routes ─────────────────────────────────────────── */}
          <Route path="/login" element={<LoginPage />} />

          {/* ── Protected routes ─────────────────────────────────────── */}
          <Route
            path="/"
            element={
              <PrivateRoute>
                <DashboardPage />
              </PrivateRoute>
            }
          />

          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <DashboardPage />
              </PrivateRoute>
            }
          />

          {/*
            Example of a role-restricted route (uncomment when the page exists):
            <Route
              path="/admin"
              element={
                <PrivateRoute requiredRole="admin">
                  <AdminPage />
                </PrivateRoute>
              }
            />
          */}

          {/* ── Catch-all ─────────────────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
