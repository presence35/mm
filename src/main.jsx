import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/tokens.css'
import './theme/global.css'
import './ui/ui.css'
import { registerAppUpdate } from './engines/pwa/update.js'
import App from './App.jsx'

registerAppUpdate()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)