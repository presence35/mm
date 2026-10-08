import { useState } from 'react'
import { TopBar, ListItem, Segmented, Button, Divider, StatusPill, Icon, Sheet, Dialog } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useTheme, PALETTES } from '../theme/ThemeProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { useAuth } from '../engines/auth/AuthProvider.jsx'
import { CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import { resetToSeed, storageProblem } from '../engines/store/localStore.js'
import { SEED_EMPLOYEE } from '../engines/store/seed.js'
import { ROLE_LABEL } from '../engines/auth/permissions.js'

const MODE_OPTIONS = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const SWATCHES = {
  'deep-water': ['#00639b', '#8b5000', '#146c2e'],
  'sunset-harbour': ['#a83f0d', '#00639b', '#146c2e'],
  'storm-watch': ['#00694a', '#8a5a00', '#146c2e'],
  'coral-bay': ['#a8203f', '#00694a', '#146c2e'],
}

function PalettePicker({ palette, onChange }) {
  return (
    <div className="palette-grid" role="radiogroup" aria-label="Colour palette">
      {PALETTES.map((p) => (
        <button key={p.id} className="palette-option" role="radio" aria-checked={palette === p.id} onClick={() => onChange(p.id)}>
          <span className="palette-option__swatches" aria-hidden="true">
            {SWATCHES[p.id].map((c) => (
              <span key={c} className="palette-option__dot" style={{ background: c }} />
            ))}
          </span>
          <span className="palette-option__text">
            <span className="palette-option__name">{p.name}</span>
            <span className="palette-option__desc">{p.desc}</span>
          </span>
          {palette === p.id ? (
            <span className="palette-option__check">
              <Icon name="check" size={18} />
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

/* TEMPORARY legacy import — delete with server/legacy/import-live.js after
   the one production import. Plans from the live legacy tables sharing this
   database, shows the dry-run report, then applies once. Admin-only. */
function LegacyImportPanel() {
  const [photosDir, setPhotosDir] = useState('/private/data/photos')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const [result, setResult] = useState(null)
  const [confirmApply, setConfirmApply] = useState(false)

  const token = () => {
    try {
      return localStorage.getItem('mm.token') ?? ''
    } catch {
      return ''
    }
  }

  const planImport = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    setReport(null)
    setResult(null)
    try {
      const res = await fetch('/api/admin/legacy-import/plan', {
        method: 'POST',
        headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ photos_dir: photosDir }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.detail || body.error || `plan failed: ${res.status}`)
      setReport(body)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const applyImport = async () => {
    if (!report || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/legacy-import/apply', {
        method: 'POST',
        headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: report.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.detail || body.error || `apply failed: ${res.status}`)
      setResult(body)
      setReport(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      setConfirmApply(false)
    }
  }

  return (
    <div>
      <div className="section-head">Legacy import (temporary)</div>
      <div style={{ padding: '0 var(--space-4) var(--space-4)', display: 'grid', gap: 'var(--space-3)' }}>
        <input
          type="text"
          value={photosDir}
          onChange={(e) => setPhotosDir(e.target.value)}
          aria-label="Legacy photos directory on the server"
          placeholder="/private/data/photos"
          style={{ font: 'var(--body-m)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--corner-s)', border: '1px solid var(--outline)' }}
        />
        <Button fullWidth variant="tonal" onClick={planImport} disabled={busy} loading={busy}>
          Plan from live tables
        </Button>
        {error ? (
          <div className="offline-bar offline-bar--conflict" role="alert">
            <Icon name="alert" size={18} />
            {error}
          </div>
        ) : null}
        {report ? (
          <div style={{ font: 'var(--body-m)', display: 'grid', gap: 'var(--space-2)' }}>
            <div>
              <strong>{report.rows} rows</strong> across {report.entities.length} entities
              {report.targetHasCustomers ? (
                <span> — target already holds {report.targetHasCustomers} customers, apply will refuse</span>
              ) : null}
            </div>
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
              <strong>Import {result.ok ? 'complete' : 'finished with problems'}.</strong> Photos copied: {result.copied}
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
  const { employee, may } = useAuth()
  const { navigate } = useRouter()
  const [showOfflineHelp, setShowOfflineHelp] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const lastSynced = sync.lastSyncedAt
    ? sync.lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'never'

  return (
    <div>
      <TopBar title="Setup" />

      <div className="section-head">Colour palette</div>
      <PalettePicker palette={palette} onChange={setPalette} />

      <div className="section-head">Appearance</div>
      <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
        <Segmented options={MODE_OPTIONS} value={mode} onChange={setMode} ariaLabel="Light or dark" />
      </div>

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

      {/* Reachable today so the offline states are testable before the
          transport lands, not a day after. */}
      <ListItem
        icon="offline"
        title="Simulate no signal"
        support="For testing the offline states"
        onClick={() => sync.setForceOffline(!sync.forceOffline)}
        trailing={<StatusPill tone={sync.forceOffline ? 'warn' : 'neutral'} shape={sync.forceOffline ? 'bar' : 'square'}>{sync.forceOffline ? 'On' : 'Off'}</StatusPill>}
      />

      <Divider />

      <div className="section-head">This device</div>
      {storageProblem() ? (
        <div className="offline-bar" role="alert" style={{ borderRadius: 'var(--corner-m)', margin: '0 var(--space-4) var(--space-3)' }}>
          <Icon name="alert" size={18} />
          Storage is not working on this device — writes are being lost. Private browsing usually
          causes this.
        </div>
      ) : null}
      <ListItem
        icon="cards"
        title="Reinstall sample data"
        support="Beta only — wipes this device back to the sample marina"
        onClick={() => setConfirmReset(true)}
        trailing={<Icon name="right" size={20} />}
      />
      <ListItem
        icon="alert"
        title="About offline behaviour"
        support="What works with no signal, and what doesn't"
        onClick={() => setShowOfflineHelp(true)}
        trailing={<Icon name="right" size={20} />}
      />

      <div className="section-head">Account</div>
      <ListItem icon="users" title={employee.name} support={ROLE_LABEL[employee.role]} />
      {/* Your own PIN, so it is not gated behind being an admin. */}
      <ListItem
        icon="pin"
        title="Change my PIN"
        support={sync.online ? 'Needs your current PIN' : 'Requires a network connection'}
        onClick={() => navigate('change-pin')}
        trailing={<Icon name="right" size={20} />}
      />
      {may(CAPABILITIES.MANAGE_EMPLOYEES) ? (
        <ListItem
          icon="tune"
          title="Admin"
          support="Employees, catalogue, templates"
          onClick={() => navigate('admin')}
          trailing={<Icon name="right" size={20} />}
        />
      ) : null}
      <ListItem icon="logout" title="Sign out" support="Requires a network connection" />

      {/* TEMPORARY legacy import — delete with server/legacy/import-http.js after the one production import. */}
      {may(CAPABILITIES.MANAGE_EMPLOYEES) ? <LegacyImportPanel /> : null}

      <Dialog
        open={confirmReset}
        title="Reinstall sample data?"
        body="Every card, log entry and photo on this device is deleted and replaced with the sample marina. This cannot be undone."
        onDismiss={() => setConfirmReset(false)}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                resetToSeed()
                setConfirmReset(false)
                navigate('cards')
              }}
            >
              Wipe and reinstall
            </Button>
          </>
        }
      />

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