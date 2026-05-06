import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ─────────────────────────────────────────────────────────────────────────────
// Vite Configuration
// https://vite.dev/config/
// ─────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),   // Tailwind v4 — replaces postcss config + tailwind.config.ts
  ],

  // ── Dev server ──────────────────────────────────────────────────────────────
  server: {
    port: 3000,
    strictPort: true,    // fail immediately instead of trying the next port

    // ── Proxy — forwards API and WebSocket requests to the backend in dev ──
    // This avoids CORS issues during development: the browser talks to
    // localhost:3000 for everything, and Vite silently routes to :5000.
    proxy: {
      // REST API
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Socket.io (supports both polling and WebSocket upgrade)
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,       // ← upgrade HTTP → WS transparently
      },
    },
  },

  // ── Build ────────────────────────────────────────────────────────────────
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Split vendor chunks for better caching in production
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) return 'react'
          if (id.includes('recharts')) return 'charts'
          if (id.includes('socket.io-client')) return 'socket'
          if (id.includes('lucide-react') || id.includes('sonner')) return 'ui'
        },
      },
    },
  },

  // ── Path aliases ─────────────────────────────────────────────────────────
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
