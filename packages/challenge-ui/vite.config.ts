import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3004,
    headers: {
      'Permissions-Policy':
        'publickey-credentials-get=*, publickey-credentials-create=*, payment=*',
    },
    proxy: {
      '/threeds': 'http://localhost:3001',
      '/webauthn': 'http://localhost:3001',
      '/spc': 'http://localhost:3001',
    },
  },
})
