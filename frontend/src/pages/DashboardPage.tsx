// ── Dashboard page stub ───────────────────────────────────────────────────────
// Full implementation comes in the dashboard module phase.
// Renders a minimal skeleton so the PrivateRoute resolves without crashing.
export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-surface-900 text-white p-6">
      {/* Navbar */}
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛡️</span>
          <h1 className="text-lg font-semibold tracking-wide">NIDS Dashboard</h1>
        </div>
        <span className="text-xs px-3 py-1 rounded-badge bg-surface-800 border border-surface-700 text-slate-400">
          Connecting…
        </span>
      </header>

      {/* Stat cards placeholder */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {['Total Packets', 'Attacks Detected', 'Detection Rate', 'Capture Status'].map((label) => (
          <div
            key={label}
            className="bg-surface-800 border border-surface-700 rounded-card p-4 animate-pulse"
          >
            <p className="text-xs text-slate-500 mb-2">{label}</p>
            <div className="h-7 bg-surface-700 rounded w-1/2" />
          </div>
        ))}
      </div>

      {/* Charts placeholder */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {['Traffic Over Time', 'Attack Distribution'].map((label) => (
          <div
            key={label}
            className="bg-surface-800 border border-surface-700 rounded-card p-4 h-56 animate-pulse"
          >
            <p className="text-xs text-slate-500 mb-4">{label}</p>
            <div className="h-full bg-surface-700 rounded" />
          </div>
        ))}
      </div>

      {/* Alerts table placeholder */}
      <div className="bg-surface-800 border border-surface-700 rounded-card p-4">
        <p className="text-sm font-medium mb-4">Recent Alerts</p>
        <p className="text-xs text-slate-500">Waiting for Socket.io connection…</p>
      </div>
    </div>
  )
}
