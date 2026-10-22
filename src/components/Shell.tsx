import { useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { railLibraries } from "../lib/homeLayout"
import { usePrefs, useSession } from "../session"
import { ErrorBoundary } from "./ErrorBoundary"
import { HeartIcon, HomeIcon, LibraryIcon, SearchIcon, SettingsIcon } from "./Icons"
import { Screensaver } from "./Screensaver"
import { StageProvider } from "./Stage"

function NavItem({ to, end = false, label, children }: { to: string; end?: boolean; label: string; children: ReactNode }) {
  return (
    <NavLink to={to} end={end} aria-label={label} className={({ isActive }) => (isActive ? "nav active" : "nav")}>
      {children}
      <span className="nav-label" aria-hidden="true">
        {label}
      </span>
    </NavLink>
  )
}

/** The tab a focus or a mouse event arrived on. */
function navTab(event: SyntheticEvent) {
  return event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".nav") : null
}

/**
 * Keep a tab's name inside the screen.
 *
 * A name is drawn centred on its own icon and, being as long as a library's own name, can run past
 * the edge of the screen: the tab nearest an edge has its name pushed back inside it. The rail's
 * right-hand group is what a name must not run under, but only for the tabs to its left: a tab that
 * lives in that group is centred on its own icon already, and clamping it against the group's own
 * left edge would push its name off the icon.
 */
function clampLabel(link: HTMLElement) {
  const label = link.querySelector<HTMLElement>(".nav-label")
  if (!label) return
  label.style.removeProperty("margin-left")
  const rect = label.getBoundingClientRect()
  if (rect.width < 2) return
  const pad = 20
  const end = link.closest(".side")?.querySelector(".side-end")
  const room = end instanceof HTMLElement && !end.contains(link) ? end.getBoundingClientRect().left - 12 : window.innerWidth - pad
  const limit = Math.min(window.innerWidth - pad, room)
  let shift = 0
  if (rect.left < pad) shift = pad - rect.left
  else if (rect.right > limit) shift = limit - rect.right
  if (shift) label.style.marginLeft = `${shift}px`
}

export function Shell() {
  const { libraries, userName } = useSession()
  const { prefs } = usePrefs()
  const location = useLocation()
  const rail = useRef<HTMLElement>(null)
  const [clock, setClock] = useState(() => new Date())
  const icon = 22
  // Home and Favorites are always here, and the libraries a server reports fill the middle - in
  // the viewer's own order once they have arranged the rail, and in Mirufin's fixed order until
  // then. Search and Settings are not browsing tabs like these: they sit in the rail's
  // right-hand group with the clock, which is where the viewer looks for them.
  const ordered = useMemo(() => railLibraries(libraries, prefs.navItems), [libraries, prefs.navItems])

  useEffect(() => {
    if (!prefs.showClock) return
    const timer = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [prefs.showClock])

  // The active page's own name is on the screen whether or not the remote is on that tab, so it is
  // placed when the page changes rather than when the tab is focused: it is the one name the rail
  // always draws, and it must not run off the edge when the viewer moves to another page.
  useEffect(() => {
    const active = rail.current?.querySelector<HTMLElement>(".nav.active")
    if (active) clampLabel(active)
  }, [location.pathname])

  /**
   * The rail draws one name at a time. A tab the remote is on names itself - loud, which is what
   * makes it unmistakable from across the room - and the active page's quiet name steps aside while
   * that is another tab, because two names on tabs a few units apart land on top of each other. The
   * page the viewer is on is still marked either way: its cyan icon and the rule under it are drawn
   * whether or not the remote is on the tab.
   */
  function nameRail(link: HTMLElement | null) {
    rail.current?.classList.toggle("rail-named", Boolean(link && !link.classList.contains("active")))
  }

  function resetLabel(event: SyntheticEvent) {
    const link = navTab(event)
    if (link) link.querySelector<HTMLElement>(".nav-label")?.style.removeProperty("margin-left")
    nameRail(null)
    // The active page keeps its name: the room the tab that has just been left was using is given
    // back to the tab that is still drawing one.
    const active = rail.current?.querySelector<HTMLElement>(".nav.active")
    if (active) clampLabel(active)
  }

  function placeLabel(event: SyntheticEvent) {
    const link = navTab(event)
    if (!link) return
    nameRail(link)
    requestAnimationFrame(() => {
      if (!link.isConnected || !link.matches(":hover, :focus-visible, .dpad-focus")) return
      clampLabel(link)
    })
  }

  return (
    <StageProvider>
    <div className="shell">
      <header className="side">
        <div className="brand" role="img" aria-label="Mirufin">
          <img className="brand-logo" src="/mirufin-logo.png" alt="" />
        </div>
        <nav
          className="side-nav"
          ref={rail}
          aria-label="Main"
          onFocus={placeLabel}
          onMouseOver={placeLabel}
          onBlur={resetLabel}
          onMouseOut={resetLabel}
        >
          <NavItem to="/" end label="Home">
            <HomeIcon size={icon} />
          </NavItem>
          <NavItem to="/favorites" label="Favorites">
            <HeartIcon size={icon} />
          </NavItem>
          {ordered.map((library) => (
            <NavItem key={library.Id} to={`/library/${library.Id}`} label={library.Name || "Library"}>
              <LibraryIcon type={library.CollectionType} name={library.Name} size={icon} />
            </NavItem>
          ))}
        </nav>
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
