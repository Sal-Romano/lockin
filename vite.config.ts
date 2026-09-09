import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:9834' },
      // the bare /e/:id page is the SPA; sub-resources (og.png, ics) always
      // proxy to the server even when navigated to directly
      '/e': {
        target: 'http://localhost:9834',
        bypass: (req) => {
          const path = (req.url ?? '').split('?')[0]
          if (/^\/e\/[^/]+\/?$/.test(path) && req.headers.accept?.includes('text/html')) return '/index.html'
        },
      },
    },
  },
})
