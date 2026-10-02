import { TopBar, ListItem, Segmented, StatusPill, Icon } from '../ui'
import { useTheme, PALETTES } from '../theme/ThemeProvider.jsx'
import { useRouter } from '../shell/RouterProvider.jsx'
import { resetToSeed } from '../engines/store/localStore.js'
import { SEED_EMPLOYEE } from '../engines/store/seed.js'

/* Sync and auth controls arrive with the sync phase. Palette and mode ship
   now because both are a release requirement, not a preference. */

const MODE_OPTIONS = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/* Preview swatches are fixed values, not live reads of the current theme —
   otherwise every swatch would render identically to the palette you picked. */
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
        <button
          key={p.id}
          className="palette-option"
          role="radio"
          aria-checked={palette === p.id}
          onClick={() => onChange(p.id)}
        >
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
  const { navigate } = useRouter()

  return (
    <div>
      <TopBar title="Setup" />

      <div className="section-head">Colour palette</div>
      <PalettePicker palette={palette} onChange={setPalette} />

      <div className="section-head">Appearance</div>
      <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
        <Segmented options={MODE_OPTIONS} value={mode} onChange={setMode} ariaLabel="Light or dark" />
      </div>

      <div className="section-head">Offline</div>
      <ListItem
        icon="offline"
        title="Sync engine"
        support="Connects in the sync phase"
        trailing={<StatusPill tone="warn" shape="bar">Pending</StatusPill>}
      />
      <ListItem
        icon="cards"
        title="Reinstall sample data"
        support="Resets this device to the seed fixture"
        onClick={resetToSeed}
        trailing={<Icon name="right" size={20} />}
      />

      <div className="section-head">Account</div>
      <ListItem icon="users" title={SEED_EMPLOYEE.name} support={SEED_EMPLOYEE.role} />
      <ListItem
        icon="logout"
        title="Sign out"
        support="Requires a network connection"
        onClick={() => navigate('setup')}
      />
    </div>
  )
}