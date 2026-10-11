/* Entry point. Every import is dynamic so a failure anywhere in the graph
   still lands in the catch below and is served as JSON over HTTP —
   Plesk's access log only shows a bare 500, which hides the cause. */

const port = Number(process.env.PORT ?? 3000)
/* GoDaddy denies binding the wildcard address; set HOST=127.0.0.1 there.
   Default stays 0.0.0.0 for hosts that proxy from another interface. */
const host = process.env.HOST || '0.0.0.0'

try {
  await import('./env.js')
  const { createServer } = await import('./index.js')
  const { collectGarbage } = await import('./sync.js')
  const { app, db } = await createServer()

  app.listen(port, host, () => {
    console.log(`marina server on http://localhost:${port}`)
  })

  const GC_INTERVAL_MS = Number(process.env.GC_INTERVAL_MS ?? 60 * 60 * 1000)
  const timer = setInterval(async () => {
    try {
      const result = await collectGarbage(db)
      if (result.deleted) console.log(`gc: removed ${result.deleted} change_log rows`)
    } catch (err) {
      console.error('gc failed:', err?.message)
    }
  }, GC_INTERVAL_MS)
  timer.unref?.()
} catch (err) {
  const detail = {
    code: err?.code ?? err?.name ?? 'BOOT_FAILED',
    message: (err?.message ?? String(err)).slice(0, 500),
    env: {
      APP_SECRET: process.env.APP_SECRET ? 'set' : 'MISSING',
      DB_HOST: process.env.DB_HOST ?? 'MISSING',
      DB_NAME: process.env.DB_NAME ?? 'MISSING',
      DB_USER: process.env.DB_USER ?? 'MISSING',
      DB_PASSWORD: process.env.DB_PASSWORD ? 'set' : 'MISSING',
    },
  }
  console.error('BOOT FAILED:', detail.code, '-', detail.message)
  const { default: express } = await import('express')
  const fallback = express()
  fallback.use((req, res) => res.status(500).json({ bootFailed: true, ...detail }))
  fallback.listen(port, host, () => {
    console.log('marina server (boot-failed fallback) listening')
  })
  await new Promise(() => {})
}
