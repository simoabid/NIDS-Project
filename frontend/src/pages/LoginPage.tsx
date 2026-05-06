// ── Login page stub ───────────────────────────────────────────────────────────
// Full implementation comes in the auth module phase.
// Renders a minimal skeleton so the router resolves without crashing.
export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-900">
      <div className="bg-surface-800 border border-surface-700 rounded-card p-8 w-full max-w-sm shadow-xl">
        <h1 className="text-xl font-semibold text-white mb-1">NIDS — Sign in</h1>
        <p className="text-sm text-slate-400 mb-6">Network Intrusion Detection System</p>

        <form className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Email</label>
            <input
              type="email"
              placeholder="admin@nids.local"
              className="w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-700 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              className="w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-700 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  )
}
