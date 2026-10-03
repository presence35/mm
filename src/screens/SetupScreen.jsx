import { useState } from 'react'
import { TopBar, ListItem, Segmented, Button, Divider, StatusPill, Icon, Sheet, Dialog } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useTheme, PALETTES } from '../theme/ThemeProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { useAuth } from '../engines/auth/AuthProvider.jsx'
import { CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import { resetToSeed } from '../engines/store/localStore.js'
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
        support={`${sync.pending} queued · last synced ${lastSynced}`}
        trailing={sync.pending ? <StatusPill tone="warn" shape="bar">{sync.pending}</StatusPill> : null}
        onClick={sync.syncNow}
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