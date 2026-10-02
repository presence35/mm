import { TopBar, ListItem, Segmented, StatusPill, Icon } from '../ui'
import { useTheme } from '../theme/ThemeProvider.jsx'
import { useRouter } from '../shell/RouterProvider.jsx'
import { resetToSeed } from '../engines/store/localStore.js'
import { SEED_EMPLOYEE } from '../engines/store/seed.js'

/* Sync and auth controls arrive with the sync phase. Theme switching ships
   now because both themes are a release requirement, not a preference. */

const THEME_OPTIONS = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export default function SetupScreen() {
  const { theme, setTheme } = useTheme()
  const { navigate } = useRouter()

  return (
    <div>
      <TopBar title="Setup" />

      <div className="section-head">Appearance</div>
      <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
        <Segmented
          options={THEME_OPTIONS}
          value={theme}
          onChange={setTheme}
          ariaLabel="Theme"
        />
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