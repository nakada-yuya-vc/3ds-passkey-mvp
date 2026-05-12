import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3003,
    proxy: {
      '/admin': 'http://localhost:3001',
    },
  },
})
