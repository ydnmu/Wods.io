import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT || 11467),
    host: '127.0.0.1',
    proxy: {
      '/api': `http://localhost:${Number(process.env.API_PORT || 4000)}`,
      '/v1': `http://localhost:${Number(process.env.API_PORT || 4000)}`,
    },
  },
})
