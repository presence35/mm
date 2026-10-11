/* Plesk entry point (its default startup file is app.js at the app root).
   All real boot logic lives in server/main.js; this is only the address. */
import './server/env.js'

await import('./server/main.js')
