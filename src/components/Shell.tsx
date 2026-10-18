import { useEffect, useMemo, useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import { menuDestinations } from "../lib/homeLayout"
import { usePrefs, useSession } from "../session"
import { ErrorBoundary } from "./ErrorBoundary"
import { GlassMenu } from "./GlassMenu"
import { Screensaver } from "./Screensaver"
import { StageProvider } from "./Stage"

export function Shell() {
  const { libraries, userName } = useSession()
  const { prefs } = usePrefs()
  const location = useLocation()
  const [clock, setClock] = useState(() => new Date())
  // The rail is one glass menu of the three library kinds Mirufin names itself - TV Shows,
  // Movies, Collections - drawn from what the server reports. See `menuDestinations`.
  const menu = useMemo(() => menuDestinations(libraries), [libraries])

  useEffect(() => {
    if (!prefs.showClock) return
    const timer = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [prefs.showClock])

  return (
    <StageProvider>
    <div className="shell">
      <header className="side">
        <div className="brand" role="img" aria-label="Mirufin">
          <img className="brand-logo" src="/mirufin-logo.png" alt="" />
        </div>
        <GlassMenu items={menu} />
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
