import { useEffect, useState } from "react"
import { NavLink, Outlet } from "react-router-dom"
import { usePrefs, useSession } from "../session"
import { CalendarIcon, ChevronIcon, HeartIcon, HomeIcon, LibraryIcon, SearchIcon, SettingsIcon } from "./Icons"
import { Screensaver } from "./Screensaver"
import { StageProvider } from "./Stage"

export function Shell() {
  const { libraries, userName } = useSession()
  const { prefs } = usePrefs()
  const [clock, setClock] = useState(() => new Date())
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("mirufin.rail") === "icons")
  const icon = collapsed ? 22 : 18

  function toggleRail() {
    setCollapsed((current) => {
      const next = !current
      localStorage.setItem("mirufin.rail", next ? "icons" : "full")
      return next
    })
  }

  useEffect(() => {
    if (!prefs.showClock) return
    const timer = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [prefs.showClock])

  return (
    <StageProvider>
    <div className={collapsed ? "shell collapsed" : "shell"}>
      <aside className="side">
        <NavLink to="/" className="brand" end title="Mirufin">
          <img className="brand-mark" src="/mirufin-m.png" alt="" />
          <img className="brand-name" src="/mirufin-name.png" alt="Mirufin" />
        </NavLink>
        <div className="side-nav-clip">
        <nav className="side-nav">
          <NavLink to="/" end title="Home" className={({ isActive }) => (isActive ? "nav active" : "nav")}>
            <HomeIcon size={icon} />
            <span>Home</span>
          </NavLink>
          <NavLink to="/favorites" title="Favorites" className={({ isActive }) => (isActive ? "nav active" : "nav")}>
            <HeartIcon size={icon} />
            <span>Favorites</span>
          </NavLink>
          <NavLink to="/search" title="Search" className={({ isActive }) => (isActive ? "nav active" : "nav")}>
            <SearchIcon size={icon} />
            <span>Search</span>
          </NavLink>
          <NavLink to="/calendar" title="Calendar" className={({ isActive }) => (isActive ? "nav active" : "nav")}>
            <CalendarIcon size={icon} />
            <span>Calendar</span>
          </NavLink>
          {libraries.length > 0 && <p className="side-label">Library</p>}
          {libraries.map((library) => (
            <NavLink key={library.Id} to={`/library/${library.Id}`} title={library.Name || "Library"} className={({ isActive }) => (isActive ? "nav active" : "nav")}>
              <LibraryIcon type={library.CollectionType} name={library.Name} size={icon} />
              <span>{library.Name || "Library"}</span>
            </NavLink>
          ))}
        </nav>
        </div>
        <div className="side-foot">
          <button className="nav rail-toggle" type="button" onClick={toggleRail} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <ChevronIcon direction={collapsed ? "right" : "left"} />
            <span>{collapsed ? "Expand" : "Collapse"}</span>
          </button>
          <NavLink to="/settings" title="Settings" className={({ isActive }) => (isActive ? "nav active" : "nav")}>
            <SettingsIcon size={icon} />
            <span>Settings</span>
          </NavLink>
          {userName && (
            <p className="account" title={userName}>
              <span className="account-mark" aria-hidden="true">{userName.slice(0, 1).toUpperCase()}</span>
              <span className="account-name">{userName}</span>
            </p>
          )}
        </div>
      </aside>
      <div className="main">
        {prefs.showClock && (
          <div className="topbar">
            <time className="clock">{clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
          </div>
        )}
        <Outlet />
      </div>
      <Screensaver />
    </div>
    </StageProvider>
  )
}
