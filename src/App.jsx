import { ThemeProvider } from './theme/ThemeProvider.jsx'
import { RouterProvider } from './shell/RouterProvider.jsx'
import AppShell from './shell/AppShell.jsx'

export default function App() {
  return (
    <ThemeProvider>
      <RouterProvider>
        <AppShell />
      </RouterProvider>
    </ThemeProvider>
  )
}