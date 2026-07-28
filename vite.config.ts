import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Honour an assigned PORT so the dev server can coexist with other
    // projects; falls back to Vite's default.
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // All /api/* routes go to our local Express server (port 3002).
      // 3001 is taken by the sUSDe term-structure dashboard.
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
})
