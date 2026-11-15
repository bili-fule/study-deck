import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@/components', replacement: `${root}components` },
      { find: '@/data', replacement: `${root}data` },
      { find: '@/utils', replacement: `${root}utils` },
      { find: '@/styles', replacement: `${root}styles` },
      { find: '@/shared', replacement: `${root}shared` },
      { find: '@/', replacement: `${root}src/` },
    ],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
})
