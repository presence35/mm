import { useRouter } from './RouterProvider.jsx'
import { useWindowClass } from './useWindowClass.js'
import { Icon } from '../ui'
import CardsScreen from '../screens/CardsScreen.jsx'
import CardDetailScreen from '../screens/CardDetailScreen.jsx'
import PeopleScreen from '../screens/PeopleScreen.jsx'
import MapScreen from '../screens/MapScreen.jsx'
import SetupScreen from '../screens/SetupScreen.jsx'
import ScanScreen from '../screens/ScanScreen.jsx'

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
  map: MapScreen,
  setup: SetupScreen,
  scan: ScanScreen,
  card: CardDetailScreen,
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
  const Screen = SCREENS[current.screen] ?? CardsScreen

  // A card detail opened from the list belongs to the Cards destination, so
  // the split layout and the nav highlight both survive navigation into it.
  const onCards = current.screen === 'cards' || current.screen === 'card'
  const split = windowClass === 'expanded' && onCards
  const activeTab = onCards ? 'cards' : NAV.some((n) => n.key === current.screen) ? current.screen : null

  if (split) {
    return (
      <div className="app-shell">
        <div className="split">
          <NavRail active={activeTab} onSelect={goTab} />
          <div className="split__list">
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
          <Screen params={current.params} />
        </main>
      </div>
      {windowClass === 'compact' ? <NavBar active={activeTab} onSelect={goTab} /> : null}
    </div>
  )
}