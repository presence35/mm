import { ThemeProvider } from './theme/ThemeProvider.jsx'
import { SyncProvider } from './engines/sync/SyncProvider.jsx'
import { AuthProvider } from './engines/auth/AuthProvider.jsx'
import { RouterProvider } from './shell/RouterProvider.jsx'
import AppShell from './shell/AppShell.jsx'

export default function App() {
  return (
    <ThemeProvider>
      <SyncProvider>
        <AuthProvider>
          <RouterProvider>
            <AppShell />
          </RouterProvider>
        </AuthProvider>
      </SyncProvider>
    </ThemeProvider>
  )
}