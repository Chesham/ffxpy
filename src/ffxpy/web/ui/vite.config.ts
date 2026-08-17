import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxied server-to-server from within this same WSL/host process, not
      // through the browser -- so it can't be shadowed by an unrelated
      // service that happens to also be bound to the backend's port on
      // whatever machine the browser itself is running on.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
