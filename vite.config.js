import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      // Local-first means the app shell is precached in production. It must NOT
      // be during development, or a stale precache masks every rebuild — the
      // exact failure documented in the old project's deploy notes.
      devOptions: { enabled: false },
      includeAssets: [],
      manifest: {
        name: 'Marina Manager',
        short_name: 'Marina',
        description: "Campbell's Landing Marina — service & storage management",
        theme_color: '#101418',
        background_color: '#101418',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // The app shell is local-first; API traffic is the server's business.
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
})