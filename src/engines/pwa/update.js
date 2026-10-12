/*
 * Keeping the installed app current.
 *
 * The app is a PWA and its shell is precached, so a deployed build does not
 * reach a device by itself: the old worker keeps serving the old index.html and
 * the old hashed assets until something replaces it. `registerType:
 * 'autoUpdate'` in vite.config.js makes the new worker activate as soon as it
 * installs (`skipWaiting`) and take over the pages already open
 * (`clientsClaim`). What it does not do is reload those pages — they are still
 * running the previous JavaScript — so that is this file's one job.
 *
 * The reload fires on `controllerchange`, which is the moment the new worker
 * claims this page. It is deferred while a form has unsaved work: taking a
 * worker's half-typed log entry to install an update is the same data loss the
 * rest of the app spends its time refusing. The reload is held, not dropped,
 * and happens as soon as the work is saved or abandoned.
 *
 * Registration itself is injected into index.html by vite-plugin-pwa, so this
 * module never calls register() and cannot disagree with the plugin's config.
 */

let hold = false
let pendingReload = false
let reloaded = false

function reloadNow() {
  if (reloaded) return
  reloaded = true
  pendingReload = false
  window.location.reload()
}

/* Called by the router whenever unsaved work starts or stops. */
export function holdReload(value) {
  hold = Boolean(value)
  if (!hold && pendingReload) reloadNow()
}

export function registerAppUpdate() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    /* Only a reload gets the already-open page onto the new build. Without
       this the update lands on the next cold start, which is how a device
       sits on a stale build for weeks. */
    if (hold) {
      pendingReload = true
      return
    }
    reloadNow()
  })
}
