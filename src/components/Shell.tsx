import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { navLabel, primaryRailLibraries } from "../lib/homeLayout"
import { usePrefs, useSession } from "../session"
import { ErrorBoundary } from "./ErrorBoundary"
import { HeartIcon, HomeIcon, LibraryIcon, SearchIcon, SettingsIcon } from "./Icons"
import { NavRail, useNavSlotMeasure } from "./NavRail"
import { Screensaver } from "./Screensaver"
import { StageProvider } from "./Stage"

function NavItem({ to, end = false, label, children }: { to: string; end?: boolean; label: string; children: ReactNode }) {
  return (
    <NavLink to={to} end={end} aria-label={label} className={({ isActive }) => (isActive ? "nav active" : "nav")}>
      <span className="nav__icon">{children}</span>
      <span className="nav-label" aria-hidden="true">{label}</span>
    </NavLink>
  )
}

export function Shell() {
  const { libraries, userName } = useSession()
  const { prefs } = usePrefs()
  const location = useLocation()
  const header = useRef<HTMLElement>(null)
  const [clock, setClock] = useState(() => new Date())
  const icon = 22
  // Home, then TV Shows · Movies · Collections, then Favorites. Search and Settings sit in the
  // right-hand group with the clock, which is where the viewer looks for them.
  const mainLibraries = useMemo(() => primaryRailLibraries(libraries, prefs.navItems), [libraries, prefs.navItems])
  useNavSlotMeasure(header, [mainLibraries, prefs.showClock, userName])

  useEffect(() => {
    if (!prefs.showClock) return
    const timer = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [prefs.showClock])

  return (
    <StageProvider>
    <div className="shell">
      <header className="side" ref={header}>
        <div className="brand" role="img" aria-label="Mirufin">
          <img className="brand-logo" src="/mirufin-logo.png" alt="" />
        </div>
        <NavRail className="side-nav" aria-label="Main">
          <NavItem to="/" end label="Home">
            <HomeIcon size={icon} />
          </NavItem>
          {mainLibraries.map((library) => (
            <NavItem key={library.Id} to={`/library/${library.Id}`} label={navLabel(library)}>
              <LibraryIcon type={library.CollectionType} name={library.Name} size={icon} />
            </NavItem>
          ))}
          <NavItem to="/favorites" label="Favorites">
            <HeartIcon size={icon} />
          </NavItem>
        </NavRail>
        <div className="side-end">
          {/* Search and Settings close the rail on the right, next to the clock: Search · Settings · Time. */}
          <NavItem to="/search" label="Search">
            <SearchIcon size={icon} />
          </NavItem>
          <NavItem to="/settings" label="Settings">
            <SettingsIcon size={icon} />
          </NavItem>
          {prefs.showClock && <time className="clock">{clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>}
          {userName && (
            <p className="account" title={userName}>
              <span className="account-mark" aria-hidden="true">{userName.slice(0, 1).toUpperCase()}</span>
              <span className="account-name">{userName}</span>
            </p>
          )}
        </div>
      </header>
      {/* The column every screen is drawn in. Where it sits when a screen opens is the
          navigation's business, not this component's: see `openAtTop` and `restoreSeat`. */}
      <div className="main">
        {/* A screen that throws is contained here rather than at the root, so the rail stays on
            screen and the remote can still walk out of it: the boundary is keyed on the route,
            so leaving the broken page clears it and the app carries on. */}
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </div>
      <Screensaver />
    </div>
    </StageProvider>
  )
}
