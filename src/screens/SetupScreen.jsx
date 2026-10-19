import { useState } from 'react'
import { TopBar, ListItem, Button, Divider, StatusPill, Icon, Sheet, Dialog, ThemeIcon, ModeIcon } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useTheme, PALETTES } from '../theme/ThemeProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { useAuth } from '../engines/auth/AuthProvider.jsx'
import { CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import { storageProblem } from '../engines/store/localStore.js'
import { ROLE_LABEL } from '../engines/auth/permissions.js'
import { APP_VERSION } from '../appVersion.js'

const MODES = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function PalettePicker({ palette, onChange }) {
  return (
    <div className="theme-grid" role="radiogroup" aria-label="Colour palette">
      {PALETTES.map((p) => (
        <button key={p.id} className="theme-option" role="radio" aria-checked={palette === p.id} onClick={() => onChange(p.id)}>
          <span className="theme-option__mark">
            <ThemeIcon palette={p.id} />
          </span>
          <span className="theme-option__text">
            <span className="theme-option__name">{p.name}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/* Same tiles as the palette picker, on purpose: the two settings answer the
   same kind of question, and a segmented control next to a grid read as two
   unrelated controls. The marks are the existing sun, moon and the half-disc
   for "follow the phone". */
function ModePicker({ mode, onChange }) {
  return (
    <div className="theme-grid" role="radiogroup" aria-label="Appearance">
      {MODES.map((m) => (
        <button
          key={m.value}
          className="theme-option"
          role="radio"
          aria-checked={mode === m.value}
          onClick={() => onChange(m.value)}
        >
          <span className="theme-option__mark">
            <ModeIcon mode={m.value} />
          </span>
          <span className="theme-option__text">
            <span className="theme-option__name">{m.label}</span>
          </span>
        </button>
      ))}
    </div>
  )
}


/* TEMPORARY legacy import — delete with server/legacy/import-live.js after
   the one production import. Plans from the live legacy tables sharing this
   database, shows the dry-run report, then applies once. Admin-only.

   No photos path field. The server owns DEFAULT_PHOTOS_DIR and the report
   echoes back the directory it actually used, so there is nothing to type and
   nothing that can be typed wrong.

   Deliberately no "reset mm tables" button. It was the cause of a lost
   migration: the only DROP TABLE in the codebase, one tap from a phone, for an
   operation that should happen once. The endpoint stays at
   server/legacy/import-live.js for an operator who needs it by hand. */
function LegacyImportPanel() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const [result, setResult] = useState(null)
  const [confirmApply, setConfirmApply] = useState(false)
  const [confirmRecord, setConfirmRecord] = useState(false)
  const [photos, setPhotos] = useState(null)
  const [photosBusy, setPhotosBusy] = useState(false)

  const call = async (path, body) => {
    let token = ''
    try {
      token = localStorage.getItem('mm.token') ?? ''
    } catch {
      token = ''
    }
    const res = await fetch(`/api/admin/legacy-import/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const parsed = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(parsed.detail || parsed.error || `${path} failed: ${res.status}`)
    return parsed
  }

  const planImport = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    setReport(null)
    setResult(null)
    try {
      setReport(await call('plan', {}))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  /* The row import refuses a second run, so the photographs it failed to copy
     have no other way across. Files only, no rows. */
  const copyPhotoFiles = async () => {
    if (photosBusy) return
    setPhotosBusy(true)
    setError('')
    setPhotos(null)
    try {
      setPhotos(await call('photos', {}))
    } catch (e) {
      setError(e.message)
    } finally {
      setPhotosBusy(false)
    }
  }

  const applyImport = async () => {
    if (!report || busy) return
    setBusy(true)
    setError('')
    try {
      setResult(await call('apply', { id: report.id }))
      setReport(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      setConfirmApply(false)
    }
  }

  /* The first import ran before the marker table existed, so a finished target
     looks exactly like a half-written one. This records what is already true
     instead of re-importing a schedule the marina is already using. */
  const recordComplete = async () => {
    if (!report || busy) return
    setBusy(true)
    setError('')
    try {
      const body = await call('complete', { id: report.id, confirm: 'record-complete' })
      setResult({ ok: true, counts: {}, copied: 0, recorded: body })
      setReport(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      setConfirmRecord(false)
    }
  }

  return (
    <div>
      <div className="section-head">Legacy import (temporary)</div>
      <div style={{ padding: '0 var(--space-4) var(--space-4)', display: 'grid', gap: 'var(--space-3)' }}>
        <Button fullWidth variant="tonal" onClick={planImport} disabled={busy} loading={busy}>
          Plan from live tables
        </Button>

        <Button
          fullWidth
          variant="outlined"
          onClick={copyPhotoFiles}
          disabled={photosBusy}
          loading={photosBusy}
        >
          Copy missing photo files
        </Button>

        {photos ? (
          <div style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', display: 'grid', gap: 'var(--space-1)' }}>
            <div>
              {photos.photosDirFound ? photos.photosDir : `${photos.photosDir} — not readable`}
            </div>
            <div>
              {photos.copied} copied · {photos.alreadyPresent} already here · {photos.missingTotal} without a file
            </div>
            {photos.missing?.length ? (
              <div>
                No file for {photos.missing.join(', ')}
                {photos.missingTotal > photos.missing.length
                  ? ` and ${photos.missingTotal - photos.missing.length} more`
                  : ''}
              </div>
            ) : null}
            <div>Reopen the card to see them; the pictures are not stored on this device.</div>
          </div>
        ) : null}
        {error ? (
          <div className="offline-bar offline-bar--conflict" role="alert">
            <Icon name="alert" size={18} />
            {error}
          </div>
        ) : null}
        {report ? (
          <div style={{ font: 'var(--body-m)', display: 'grid', gap: 'var(--space-2)' }}>
            <div>
              <strong>{report.rows} rows</strong> to import across {report.entities.length} entities
            </div>

            {/* Which state the target is actually in.
                "Rows present and no marker" is not evidence that a run failed —
                the first one finished before the marker table existed — so
                count the two sides and say what they show. */}
            {report.state?.imported ? (
              <div style={{ color: 'var(--on-surface-variant)' }}>
                A previous import finished {new Date(report.state.completedAt).toLocaleString()}. Importing again would
                duplicate every row.
              </div>
            ) : report.state?.verdict === 'complete' ? (
              <div style={{ color: 'var(--on-surface-variant)' }}>
                This database already holds everything this plan would write
                {report.state.targetRows ? ` (${report.state.targetRows} rows)` : ''}. The migration has run; it was just
                never recorded.
              </div>
            ) : report.state?.verdict === 'partial' ? (
              <div style={{ color: 'var(--on-surface-variant)' }}>
                This database holds some of it and no finished import. Short:{' '}
                {report.state.missing.map((m) => `${m.entity} ${m.have}/${m.want}`).join(', ')}.
              </div>
            ) : (
              <div style={{ color: 'var(--on-surface-variant)' }}>The target is empty. Nothing has been imported yet.</div>
            )}

            {!report.state?.imported && report.state?.verdict === 'complete' ? (
              <Button fullWidth variant="tonal" onClick={() => setConfirmRecord(true)} disabled={busy}>
                Record this import as complete
              </Button>
            ) : null}

            <details>
              <summary style={{ font: 'var(--label-m)', padding: 'var(--space-2) 0' }}>
                What is already in the target, entity by entity
              </summary>
              <table style={{ width: '100%', borderCollapse: 'collapse', font: 'var(--body-s)' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--on-surface-variant)' }}>
                    <th style={{ padding: 'var(--space-1) 0' }}>Entity</th>
                    <th style={{ padding: 'var(--space-1) 0', textAlign: 'right' }}>To import</th>
                    <th style={{ padding: 'var(--space-1) 0', textAlign: 'right' }}>Already there</th>
                  </tr>
                </thead>
                <tbody>
                  {[...new Set([...report.entities, ...Object.keys(report.targetCounts ?? {})])].map((e) => (
                    <tr key={e}>
                      <td style={{ padding: 'var(--space-1) 0' }}>{e}</td>
                      <td style={{ padding: 'var(--space-1) 0', textAlign: 'right' }}>{report.sourceCounts?.[e] ?? 0}</td>
                      <td style={{ padding: 'var(--space-1) 0', textAlign: 'right' }}>
                        {report.targetCounts?.[e] ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>

            <div>
              Photos from {report.photosDir}: {report.photosToCopy} to copy, {report.photosMissingTotal} without a file
              {report.photosDirFound ? null : ' (directory not readable on the server)'}
            </div>
            {report.notes.map((n) => (
              <div key={n} style={{ color: 'var(--on-surface-variant)' }}>
                {n}
              </div>
            ))}
            {report.warnings.map((w) => (
              <div key={w}>! {w}</div>
            ))}
            {report.warningTotal > report.warnings.length ? <div>…and {report.warningTotal - report.warnings.length} more</div> : null}
            <Button fullWidth variant="destructive" onClick={() => setConfirmApply(true)} disabled={busy}>
              Apply import
            </Button>
          </div>
        ) : null}
        {result ? (
          <div style={{ font: 'var(--body-m)', display: 'grid', gap: 'var(--space-2)' }}>
            <div>
              <strong>
                {result.recorded ? 'Recorded as complete.' : `Import ${result.ok ? 'complete' : 'finished with problems'}.`}
              </strong>{' '}
              {result.copied ? `Photos copied: ${result.copied}` : null}
            </div>
            {Object.entries(result.counts ?? {}).map(([entity, n]) => (
              <div key={entity}>
                {entity}: {n}
              </div>
            ))}
            {(result.problems ?? []).map((p) => (
              <div key={p}>! {p}</div>
            ))}
          </div>
        ) : null}
      </div>
      <Dialog
        open={confirmRecord}
        title="Record this import as complete?"
        body="Marks the legacy migration as done without writing anything. It says the target already holds everything the plan would write, so the only thing missing is the record. Nothing is copied, nothing is deleted."
        onDismiss={() => setConfirmRecord(false)}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmRecord(false)}>
              Cancel
            </Button>
            <Button onClick={recordComplete}>Record as complete</Button>
          </>
        }
      />
      <Dialog
        open={confirmApply}
        title="Apply legacy import?"
        body="Every legacy row is inserted into the live database once. This cannot be undone — a second run is refused, so a partial failure needs manual repair."
        onDismiss={() => setConfirmApply(false)}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmApply(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={applyImport}>
              Apply
            </Button>
          </>
        }
      />
    </div>
  )
}

export default function SetupScreen() {
  const { palette, setPalette, mode, setMode } = useTheme()
  const sync = useSync()
  const { employee, may, signOut } = useAuth()
  const { navigate } = useRouter()
  const [showOfflineHelp, setShowOfflineHelp] = useState(false)
  const lastSynced = sync.lastSyncedAt
    ? sync.lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'never'

  /* Role and name, unless the name already is the role. */
  const roleLabel = ROLE_LABEL[employee.role]
  const signOutSupport =
    roleLabel.toLowerCase() === String(employee.name).trim().toLowerCase()
      ? roleLabel
      : `${roleLabel} · ${employee.name}`

  return (
    <div>
      <TopBar title="Setup" />

      <div className="section-head">Colour palette</div>
      <PalettePicker palette={palette} onChange={setPalette} />

      <div className="section-head">Appearance</div>
      <ModePicker mode={mode} onChange={setMode} />

      {/* Sync and the device it runs on are one subject: what is queued, what
          has been sent, and what to read when there is no signal. They used to
          be two headings with the same rows under them. */}
      <div className="section-head">Sync</div>
      <ListItem
        icon={sync.state === 'offline' ? 'offline' : 'sync'}
        title={
          sync.state === 'offline'
            ? 'Offline'
            : sync.state === 'syncing'
              ? 'Syncing…'
              : sync.state === 'conflict'
                ? 'Needs review'
                : sync.state === 'error'
                  ? 'Sync failed'
                  : 'Up to date'
        }
        support={`${sync.pending} queued · last synced ${lastSynced}${sync.failure ? ` · ${sync.failure}` : ''}`}
        trailing={
          sync.conflicts ? (
            <StatusPill tone="warn" shape="diamond">{sync.conflicts}</StatusPill>
          ) : sync.pending ? (
            <StatusPill tone="warn" shape="bar">{sync.pending}</StatusPill>
          ) : null
        }
        onClick={() => (sync.conflicts ? navigate('conflicts') : sync.syncNow())}
      />

      {storageProblem() ? (
        <div className="offline-bar" role="alert" style={{ borderRadius: 'var(--corner-m)', margin: '0 var(--space-4) var(--space-3)' }}>
          <Icon name="alert" size={18} />
          Storage is not working on this device — writes are being lost. Private browsing usually
          causes this.
        </div>
      ) : null}
      <ListItem
        icon="alert"
        title="About offline behaviour"
        support="What works with no signal, and what doesn't"
        onClick={() => setShowOfflineHelp(true)}
        trailing={<Icon name="right" size={20} />}
      />

      <Divider />

      {may(CAPABILITIES.MANAGE_EMPLOYEES) ? (
        <>
          <div className="section-head">Admin</div>
          <ListItem
            icon="tune"
            title="Staff, parts & labels"
            support="Employees, catalogue, checklist templates"
            onClick={() => navigate('admin')}
            trailing={<Icon name="right" size={20} />}
          />

          <LegacyImportPanel />
        </>
      ) : null}

      <div className="section-head">Account</div>
      {/* Your own PIN, so it is not gated behind being an admin. */}
      <ListItem
        icon="keypad"
        title="Change my PIN"
        support={sync.online ? 'Needs your current PIN' : 'Requires a network connection'}
        onClick={() => navigate('change-pin')}
        trailing={<Icon name="right" size={20} />}
      />
      {/* Who is signed in, on the row that ends the session. Role and name are
          both useful — the role is what you are allowed to do, the name is who
          you are — but the yard's admin account is literally named "admin", and
          "Admin · admin" reads like a mistake rather than a fact. */}
      <ListItem
        icon="logout"
        title="Sign out"
        support={signOutSupport}
        onClick={signOut}
        trailing={<Icon name="right" size={20} />}
      />

      {/* Footnote, not a setting. Read from package.json at build time, so it
          cannot disagree with what shipped. The bottom padding clears the
          navigation bar so it is readable rather than tucked under it. */}
      <p
        style={{
          font: 'var(--body-s)',
          color: 'var(--on-surface-variant)',
          textAlign: 'center',
          padding: 'var(--space-4) var(--space-4) calc(var(--nav-bar-height) + var(--space-6))',
        }}
      >
        Marina Manager · version {APP_VERSION}
      </p>

      <Sheet open={showOfflineHelp} title="Offline behaviour" onDismiss={() => setShowOfflineHelp(false)}>
        <div style={{ padding: '0 var(--space-4) var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
          <p style={{ font: 'var(--body-m)' }}>
            <strong>Works offline.</strong> Reading every card, ticking tasks, writing log entries,
            rating condition, changing status. All of it saves to this device first and syncs when
            you get signal.
          </p>
          <p style={{ font: 'var(--body-m)' }}>
            <strong>Needs a connection.</strong> Photos, invoicing, and anything admin-only. If you
            try one of these with no signal the app says so rather than pretending it saved.
          </p>
          <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)' }}>
            <strong>If two people edit the same card offline</strong>, nothing is thrown away. Both
            versions are kept and the card is flagged for review when you reconnect.
          </p>
          <Button fullWidth variant="tonal" onClick={() => setShowOfflineHelp(false)}>
            Got it
          </Button>
        </div>
      </Sheet>
    </div>
  )
}