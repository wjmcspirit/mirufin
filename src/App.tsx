import { useEffect, useRef, useState } from "react"
import { Navigate, Route, Routes, useNavigate } from "react-router-dom"
import { RemoteNav } from "./components/RemoteNav"
import { Shell } from "./components/Shell"
import { UpdatePrompt } from "./components/UpdatePrompt"
import * as api from "./lib/api"
import { discoverServers, type FoundServer } from "./lib/discover"
import { markStartupReady } from "./lib/startup"
import { normalizeServer } from "./lib/storage"
import { ConnectPage } from "./pages/Connect"
import { FavoritesPage } from "./pages/Favorites"
import { HomePage } from "./pages/Home"
import { ItemPage } from "./pages/Item"
import { LibraryPage } from "./pages/Library"
import { LoginPage } from "./pages/Login"
import { PlayerPage } from "./pages/Player"
import { SearchPage } from "./pages/Search"
import { SettingsPage } from "./pages/Settings"
import { useSession } from "./session"

function RequireAuth() {
  const { serverUrl, accessToken } = useSession()
  if (!serverUrl) return <Navigate to="/connect" replace />
  if (!accessToken) return <Navigate to="/login" replace />
  return <Shell />
}

export function App() {
  useEffect(() => {
    document.getElementById("boot")?.remove()
    // Tell the Android shell the app is up, so a launch that dies early can be healed.
    void markStartupReady()
  }, [])

  return (
    <>
      <RemoteNav />
      <UpdatePrompt />
      <ServerDiscovery />
      <Routes>
      <Route path="/connect" element={<ConnectPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/library/:id" element={<LibraryPage />} />
        <Route path="/item/:id" element={<ItemPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<p className="empty">That page is not in Mirufin.</p>} />
      </Route>
      <Route path="/play/:id" element={<PlayGate />} />
      </Routes>
    </>
  )
}

/** Bound the reachability check so a dead saved server never delays startup. */
const SERVER_CHECK_MS = 3500

function ServerDiscovery() {
  const { serverUrl, connect } = useSession()
  const navigate = useNavigate()
  const [suggestion, setSuggestion] = useState<FoundServer | null>(null)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState("")
  const tried = useRef("")
  const connectRef = useRef(connect)
  connectRef.current = connect

  useEffect(() => {
    if (!serverUrl || tried.current === serverUrl) return
    tried.current = serverUrl
    let cancel = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), SERVER_CHECK_MS)
    // A saved server that does not answer is never replaced on our own. We only
    // look for a nearby server and offer it, leaving the saved server and any
    // stored credentials exactly as they were until the viewer confirms.
    api
      .publicInfo(controller.signal)
      .catch(async () => {
        if (cancel) return
        const found = await discoverServers()
        if (cancel) return
        const others = found.filter((server) => {
          try {
            return normalizeServer(server.address) !== serverUrl
          } catch {
            return false
          }
        })
        if (others.length > 0) setSuggestion(others[0])
      })
    return () => {
      cancel = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [serverUrl])

  if (!suggestion) return null

  async function switchServer() {
    if (!suggestion) return
    setSwitching(true)
    setError("")
    try {
      await connectRef.current(suggestion.address)
      setSuggestion(null)
      navigate("/login")
    } catch (caught) {
      setSwitching(false)
      setError(caught instanceof Error ? caught.message : "Could not reach that Jellyfin server.")
    }
  }

  return (
    <section className="server-suggestion" role="dialog" aria-label="Another Jellyfin server was found">
      <p className="eyebrow">Server found</p>
      <h2>{suggestion.name || "Jellyfin"}</h2>
      <p className="hint">{suggestion.address}</p>
      <p className="hint">The saved server did not answer. Switch to this one?</p>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="btn btn-primary" type="button" onClick={() => void switchServer()} disabled={switching}>
          {switching ? "Switching…" : "Switch server"}
        </button>
        <button className="btn" type="button" onClick={() => setSuggestion(null)} disabled={switching}>
          Not now
        </button>
      </div>
    </section>
  )
}

function PlayGate() {
  const { serverUrl, accessToken } = useSession()
  if (!serverUrl) return <Navigate to="/connect" replace />
  if (!accessToken) return <Navigate to="/login" replace />
  return <PlayerPage />
}
