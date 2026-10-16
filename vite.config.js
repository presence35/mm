import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { APP_VERSION } from './version.js'

export default defineConfig({
  define: {
    /* Carries the commit, so a deploy that changed nothing but code still
       shows a different build on Setup. See version.js. */
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  plugins: [
    react(),
    VitePWA({
      /* autoUpdate, not prompt. The shell is precached, so without a new worker
         taking over, a deployed build never reaches a device: the old worker
         keeps serving the old index.html and the old hashed assets. This adds
         skipWaiting + clientsClaim to the generated worker; engines/pwa/update.js
         then reloads the open page once it is safe to. */
      registerType: 'autoUpdate',
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
        /* The previous marina app lives under /legacy/ on the same origin.
           Without this, the root worker serves the new shell for /legacy/
           navigations on phones where the PWA is installed — the exact
           report that motivated it. The legacy subtree has its own worker. */
        navigateFallbackDenylist: [/^\/legacy\//],
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