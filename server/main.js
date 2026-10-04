import { createServer } from './index.js'
import { collectGarbage } from './sync.js'

const port = Number(process.env.PORT ?? 3000)
const { app, db } = await createServer()

app.listen(port, () => {
  console.log(`marina server on http://localhost:${port}`)
})

/*
 * The change log grows forever unless something trims it. The admin endpoint
 * existed but nothing called it, so it never ran.
 *
 * Scheduled here rather than left to a cron job because GoDaddy does not
 * guarantee one, and a deploy that silently stops garbage-collecting is exactly
 * the kind of thing that is only noticed months later. collectGarbage protects
 * any device that has not yet seen a change, so running it more often than the
 * GC floor requires is safe — it deletes nothing a dark device still needs.
 */
const GC_INTERVAL_MS = Number(process.env.GC_INTERVAL_MS ?? 60 * 60 * 1000)

const timer = setInterval(async () => {
  try {
    const result = await collectGarbage(db)
    if (result.deleted) console.log(`gc: removed ${result.deleted} change_log rows`)
  } catch (err) {
    /* Never let housekeeping take the process down. */
    console.error('gc failed:', err?.message)
  }
}, GC_INTERVAL_MS)

/* The timer must not be the reason the process stays alive on its own. */
timer.unref?.()