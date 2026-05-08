import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import PrivateRoute from '@/components/PrivateRoute'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import AlertsPage from '@/pages/AlertsPage'
import CapturePage from '@/pages/CapturePage'
import AuditPage from '@/pages/AuditPage'

// ─────────────────────────────────────────────────────────────────────────────
// App — root router
//
// Nested route structure:
//   /login                   — public (no layout)
//   / (PrivateRoute)         — AppLayout wrapper
//     /dashboard             — DashboardPage
//     /alerts                — AlertsPage
//     /capture               — CapturePage   (admin)
//     /audit-log             — AuditPage     (admin)
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* ── Public ──────────────────────────────────────────────── */}
          <Route path="/login" element={<LoginPage />} />

          {/* ── Protected — all share the AppLayout shell ──────────── */}
          <Route
            element={
              <PrivateRoute>
                <AppLayout />
              </PrivateRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route
              path="capture"
              element={
                <PrivateRoute requiredRole="admin">
                  <CapturePage />
                </PrivateRoute>
              }
            />
            <Route
              path="audit-log"
              element={
                <PrivateRoute requiredRole="admin">
                  <AuditPage />
                </PrivateRoute>
              }
            />
          </Route>

          {/* ── Catch-all ───────────────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
