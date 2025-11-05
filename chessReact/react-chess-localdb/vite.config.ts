import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://172.22.111.136:7000',
        changeOrigin: true,
        secure: false
      }
    },
    hmr: {
      host: '172.22.111.136',
      protocol: 'ws',
      port: 5173
    }
  }
})
