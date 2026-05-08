// ── AppLayout — sidebar + top bar shell ────────────────────────────────────
// frontend/src/components/layout/AppLayout.tsx
//
// Wraps all protected pages. Sidebar provides navigation, top bar shows
// capture status + logout. Page content renders via <Outlet />.
// ───────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Bell,
  Radio,
  ScrollText,
  Shield,
  LogOut,
  Menu,
  X,
  Loader2,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCaptureStatus } from '@/hooks/useCaptureStatus'
import socket from '@/services/socket'

// ── Navigation config ──────────────────────────────────────────────────────

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',       label: 'Dashboard',       icon: <LayoutDashboard className="h-[18px] w-[18px]" /> },
  { to: '/alerts',          label: 'Alerts',          icon: <Bell className="h-[18px] w-[18px]" /> },
  { to: '/capture',         label: 'Capture Control', icon: <Radio className="h-[18px] w-[18px]" />, adminOnly: true },
  { to: '/audit-log',       label: 'Audit Log',       icon: <ScrollText className="h-[18px] w-[18px]" />, adminOnly: true },
]

// ── Sidebar link component ─────────────────────────────────────────────────

function SidebarLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  return (
    <NavLink
      to={item.to}
      onClick={onClick}
      className={({ isActive }) =>
        [
          'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
          isActive
            ? 'bg-brand-500/10 text-brand-500'
            : 'text-slate-400 hover:text-white hover:bg-surface-800',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          {/* Active indicator pill */}
          {isActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-brand-500" />
          )}
          {item.icon}
          <span>{item.label}</span>
          {item.adminOnly && (
            <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-600 font-semibold">
              Admin
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AppLayout() {
  const { user, logout } = useAuth()
  const { isActive: captureActive } = useCaptureStatus()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const isAdmin = user?.role === 'admin'
  const socketConnected = socket.connected

  // Derive page title from current route
  const pageTitle = NAV_ITEMS.find((item) => location.pathname.startsWith(item.to))?.label ?? 'Dashboard'

  // Filter nav items by role
  const visibleNav = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)

  async function handleLogout() {
    setLoggingOut(true)
    await logout()
  }

  function closeSidebar() {
    setSidebarOpen(false)
  }

  // ── User initials ─────────────────────────────────────────────────────

  const initials = user?.email
    ? user.email.substring(0, 2).toUpperCase()
    : '??'

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh flex bg-surface-900">
      {/* ── Mobile overlay ─────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-surface-700/50 bg-surface-900 transition-transform duration-200 ease-out lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 pt-6 pb-2">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-brand-500/10 border border-brand-500/20">
            <Shield className="h-[18px] w-[18px] text-brand-500" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white tracking-tight">NIDS</h1>
            <p className="text-[11px] text-slate-500 leading-tight">Intrusion Detection</p>
          </div>

          {/* Mobile close */}
          <button
            onClick={closeSidebar}
            className="ml-auto lg:hidden text-slate-500 hover:text-white transition-colors"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 pt-6 space-y-1" aria-label="Main navigation">
          {visibleNav.map((item) => (
            <SidebarLink key={item.to} item={item} onClick={closeSidebar} />
          ))}
        </nav>

        {/* User block */}
        <div className="px-4 pb-5 pt-3 border-t border-surface-700/50">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-500/15 text-brand-500 text-xs font-semibold">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{user?.email ?? 'Unknown'}</p>
              <span className="inline-flex items-center text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                {user?.role ?? 'viewer'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main area ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* ── Top bar ────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30 flex items-center gap-4 h-14 px-4 lg:px-6 border-b border-surface-700/50 bg-surface-900/80 backdrop-blur-md">

          {/* Mobile hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-slate-400 hover:text-white transition-colors -ml-1"
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Page title */}
          <h2 className="text-sm font-medium text-white">{pageTitle}</h2>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Status cluster */}
          <div className="flex items-center gap-3">

            {/* Capture status */}
            <div className="hidden sm:flex items-center gap-2 text-xs">
              <span className="relative flex h-2 w-2">
                <span
                  className={[
                    'absolute inline-flex h-full w-full rounded-full opacity-75',
                    captureActive ? 'bg-success-500 animate-ping' : 'bg-slate-600',
                  ].join(' ')}
                />
                <span
                  className={[
                    'relative inline-flex h-2 w-2 rounded-full',
                    captureActive ? 'bg-success-500' : 'bg-slate-600',
                  ].join(' ')}
                />
              </span>
              <span className={captureActive ? 'text-success-500' : 'text-slate-500'}>
                {captureActive ? 'Capturing' : 'Idle'}
              </span>
            </div>

            {/* Divider */}
            <div className="hidden sm:block w-px h-4 bg-surface-700/50" />

            {/* Socket connection */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs" title={socketConnected ? 'Socket connected' : 'Socket disconnected'}>
              {socketConnected
                ? <Wifi className="h-3.5 w-3.5 text-success-500" />
                : <WifiOff className="h-3.5 w-3.5 text-danger-500" />
              }
            </div>

            {/* Divider */}
            <div className="w-px h-4 bg-surface-700/50" />

            {/* Logout */}
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Sign out"
            >
              {loggingOut
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <LogOut className="h-4 w-4" />
              }
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {/* ── Page content ───────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
