import { useEffect, useMemo, useState, type ReactNode, type SyntheticEvent } from "react"
import { NavLink, Outlet } from "react-router-dom"
import { sortLibraries } from "../lib/homeLayout"
import { usePrefs, useSession } from "../session"
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

export function Shell() {
  const { libraries, userName } = useSession()
  const { prefs } = usePrefs()
  const [clock, setClock] = useState(() => new Date())
  const icon = 22
  // Home, Search, Favorites and Settings are always here; the libraries a server
  // reports fill the middle, in a fixed order rather than the server's own.
  const ordered = useMemo(() => sortLibraries(libraries), [libraries])

  useEffect(() => {
    if (!prefs.showClock) return
    const timer = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [prefs.showClock])

  function resetLabel(event: SyntheticEvent) {
    const link = event.target instanceof HTMLElement ? event.target.closest(".nav") : null
    const label = link?.querySelector<HTMLElement>(".nav-label")
    if (label) label.style.removeProperty("margin-left")
  }

  function placeLabel(event: SyntheticEvent) {
    const link = event.target instanceof HTMLElement ? event.target.closest(".nav") : null
    if (!(link instanceof HTMLElement)) return
    const label = link.querySelector<HTMLElement>(".nav-label")
    if (!label) return
    requestAnimationFrame(() => {
      if (!link.isConnected || !link.matches(":hover, :focus-visible, .dpad-focus")) return
      label.style.removeProperty("margin-left")
      const rect = label.getBoundingClientRect()
      if (rect.width < 2) return
      const pad = 20
      const end = link.closest(".side")?.querySelector(".side-end")
      const endLeft = end instanceof HTMLElement ? end.getBoundingClientRect().left - 12 : window.innerWidth - pad
      const limit = Math.min(window.innerWidth - pad, endLeft)
      let shift = 0
      if (rect.left < pad) shift = pad - rect.left
      else if (rect.right > limit) shift = limit - rect.right
      if (shift) label.style.marginLeft = `${shift}px`
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
          aria-label="Main"
          onFocus={placeLabel}
          onMouseOver={placeLabel}
          onBlur={resetLabel}
          onMouseOut={resetLabel}
        >
          <NavItem to="/" end label="Home">
            <HomeIcon size={icon} />
          </NavItem>
          <NavItem to="/search" label="Search">
            <SearchIcon size={icon} />
          </NavItem>
          <NavItem to="/favorites" label="Favorites">
            <HeartIcon size={icon} />
          </NavItem>
          {ordered.map((library) => (
            <NavItem key={library.Id} to={`/library/${library.Id}`} label={library.Name || "Library"}>
              <LibraryIcon type={library.CollectionType} name={library.Name} size={icon} />
            </NavItem>
          ))}
          <NavItem to="/settings" label="Settings">
            <SettingsIcon size={icon} />
          </NavItem>
        </nav>
        <div className="side-end">
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
        <Outlet />
      </div>
      <Screensaver />
    </div>
    </StageProvider>
  )
}
