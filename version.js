/*
 * One answer to "which build is this", shared by the built client and the
 * running server.
 *
 * Neither used to ask. `vite.config.js` baked package.json's version in and
 * `/api/version` regexed the same file per request, so the number only moved
 * when a human edited it — a deploy would land and the version would read
 * exactly as before, which is the one moment you most want it to differ. The
 * commit is what changes on every push, so the commit is what it is built from:
 * `<package version>+<commit count>.<short sha>`.
 *
 * Node-only. The client receives the result through Vite's `define` and never
 * imports this file — see `src/appVersion.js`.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    /* No git on PATH, or the tree was copied without `.git` — a build host may
       do either. Reporting the base version is honest; reporting a failure, or
       inventing a number, is not. */
    return ''
  }
}

/* Pure, so the rule is testable without a repository: the commit count and sha
   are what make the number move, and their absence must fall back rather than
   produce `0.2.1+.`. */
export function formatVersion({ base, count, sha }) {
  if (!count || !sha) return base
  return `${base}+${count}.${sha}`
}

export const APP_VERSION = formatVersion({
  base: pkg.version,
  count: git(['rev-list', '--count', 'HEAD']),
  sha: git(['rev-parse', '--short', 'HEAD']),
})
