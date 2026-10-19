import { useEffect, useState } from 'react'
import { ThemeProvider } from './theme/ThemeProvider.jsx'
import { SyncProvider } from './engines/sync/SyncProvider.jsx'
import { AuthProvider } from './engines/auth/AuthProvider.jsx'
import { RouterProvider } from './shell/RouterProvider.jsx'
import AppShell from './shell/AppShell.jsx'
import * as store from './engines/store/localStore.js'

/* Reads are synchronous, storage is async. Hydrate once before the first
   render so no screen ever sees an empty projection and flashes an empty
   state at a worker standing on a dock. */
function Boot({ children }) {
  const [ready, setReady] = useState(store.isHydrated())

  useEffect(() => {
    store.hydrate().then(async () => {
      /* Dev only, and a dead branch in a production build: a fresh origin has no
         rows, so there would be nothing to look at. See devFixture.js. It seeds
         after hydrate, before the first paint, so no screen flashes an empty
         list. */
      if (import.meta.env.DEV) {
        const { seedDevData } = await import('./engines/store/devFixture.js')
        await seedDevData()
      }
      setReady(true)
    })
  }, [])

  if (!ready) return null
  return children
}

export default function App() {
  return (
    <ThemeProvider>
      <SyncProvider>
        <Boot>
          <AuthProvider>
            <RouterProvider>
              <AppShell />
            </RouterProvider>
          </AuthProvider>
        </Boot>
      </SyncProvider>
    </ThemeProvider>
  )
}