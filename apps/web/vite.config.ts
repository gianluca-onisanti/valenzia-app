import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Em dev, /api vai para a API Node (`npm run dev` na raiz sobe as duas). No
 * container, quem faz esse papel e o nginx. O front nao le nada de public/:
 * mapas e camadas vem todos do banco, pela API.
 */
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
    },
  },
})
