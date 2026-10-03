import { useRouter } from './RouterProvider.jsx'
import { useWindowClass } from './useWindowClass.js'
import { Icon, OfflineBar } from '../ui'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { useAuth } from '../engines/auth/AuthProvider.jsx'
import CardsScreen from '../screens/CardsScreen.jsx'
import CardDetailScreen from '../screens/CardDetailScreen.jsx'
import PeopleScreen from '../screens/PeopleScreen.jsx'
import PeopleDetailScreen from '../screens/PeopleDetailScreen.jsx'
import MapScreen from '../screens/MapScreen.jsx'
import SetupScreen from '../screens/SetupScreen.jsx'
import ScanScreen from '../screens/ScanScreen.jsx'
import NewCardScreen from '../screens/NewCardScreen.jsx'
import InvoiceScreen from '../screens/InvoiceScreen.jsx'
import AdminScreen from '../screens/AdminScreen.jsx'
import PublicCardScreen from '../screens/PublicCardScreen.jsx'
import LoginScreen from '../screens/LoginScreen.jsx'

const NAV = [
  { key: 'cards', label: 'Cards', icon: 'cards' },
  { key: 'people', label: 'People', icon: 'users' },
  { key: 'map', label: 'Map', icon: 'map' },
  { key: 'setup', label: 'Setup', icon: 'tune' },
  { key: 'scan', label: 'Scan', icon: 'qr' },
]

const SCREENS = {
  cards: CardsScreen,
  people: PeopleScreen,
  'people-detail': PeopleDetailScreen,
  map: MapScreen,
  setup: SetupScreen,
  scan: ScanScreen,
  card: CardDetailScreen,
  'new-card': NewCardScreen,
  invoice: InvoiceScreen,
  admin: AdminScreen,
}

function NavBar({ active, onSelect }) {
  return (
    <nav className="nav-bar" aria-label="Main">
      {NAV.map((n) => (
        <button
          key={n.key}
          className="nav-bar__item"
          aria-current={active === n.key ? 'page' : undefined}
          onClick={() => onSelect(n.key)}
        >
          <Icon name={n.icon} size={24} />
          <span className="nav-bar__label">{n.label}</span>
        </button>
      ))}
    </nav>
  )
}

function NavRail({ active, onSelect }) {
  return (
    <nav className="nav-rail" aria-label="Main">
      {NAV.map((n) => (
        <button
          key={n.key}
          className="nav-rail__item"
          aria-current={active === n.key ? 'page' : undefined}
          onClick={() => onSelect(n.key)}
        >
          <Icon name={n.icon} size={24} />
          <span className="nav-bar__label">{n.label}</span>
        </button>
      ))}
    </nav>
  )
}

export default function AppShell() {
  const { current, goTab } = useRouter()
  const windowClass = useWindowClass()
  const sync = useSync()
  const { state: authState } = useAuth()
  const Screen = SCREENS[current.screen] ?? CardsScreen

  // The public customer view is a separate surface with no app chrome, no
  // navigation and no session. Reached by scanning the QR on the customer's
  // copy of the card. See docs/behaviors-public-view.md.
  //
  // Presence of the param is the trigger, not its truthiness: `?wo=` is a
  // malformed link and must answer identically to an unknown one.
  const search = new URLSearchParams(window.location.search)
  if (search.has('wo')) return <PublicCardScreen token={search.get('wo')} />

  /* Online with no server session: sign in. Offline with a cached one:
     unlock. Offline with neither: sign in is impossible, so say so rather
     than showing an empty app. */
  if (!sync.hasCachedSession) return <LoginScreen />
  if (authState === 'anonymous') return <LoginScreen />

  // A card detail opened from the list belongs to the Cards destination, so
  // the split layout and the nav highlight both survive navigation into it.
  const onCards = current.screen === 'cards' || current.screen === 'card'
  const split = windowClass === 'expanded' && onCards
  const activeTab = onCards ? 'cards' : NAV.some((n) => n.key === current.screen) ? current.screen : null

  const offline = <OfflineBar state={sync.state} pending={sync.pending} />

  if (split) {
    return (
      <div className="app-shell">
        <div className="split">
          <NavRail active={activeTab} onSelect={goTab} />
          <div className="split__list">
            {offline}
            <CardsScreen />
          </div>
          <div className="split__detail">
            <CardDetailScreen params={current.params} embedded selected={current.screen === 'card'} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {windowClass !== 'compact' ? <NavRail active={activeTab} onSelect={goTab} /> : null}
        <main className="screen-body">
          {offline}
          <Screen params={current.params} />
        </main>
      </div>
      {windowClass === 'compact' ? <NavBar active={activeTab} onSelect={goTab} /> : null}
    </div>
  )
}